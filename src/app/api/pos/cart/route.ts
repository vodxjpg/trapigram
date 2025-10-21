// src/app/api/pos/cart/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/** Small result envelope for idempotent execs */
type ExecResult = { status: number; body: any; headers?: Record<string, string> };

/** Standard security/perf headers for mutable responses */
const BASE_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  "X-Content-Type-Options": "nosniff",
};

/** DB-backed idempotency (preserves existing behaviour; now adds headers) */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<ExecResult>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  const method = req.method;
  const path = new URL(req.url).pathname;

  // Fast path: no key => just execute, still set headers.
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, {
      status: r.status,
      headers: { ...BASE_HEADERS, ...(r.headers ?? {}) },
    });
  }

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt") VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      // Replay path (unique violation)
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) {
          return NextResponse.json(rows[0].response, {
            status: rows[0].status,
            headers: BASE_HEADERS,
          });
        }
        return NextResponse.json(
          { error: "Idempotency replay but no record" },
          { status: 409, headers: BASE_HEADERS }
        );
      }
      // Table missing: proceed without idempotency persistence
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return NextResponse.json(r.body, {
          status: r.status,
          headers: { ...BASE_HEADERS, ...(r.headers ?? {}) },
        });
      }
      throw e;
    }

    const r = await exec();

    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");

    return NextResponse.json(r.body, {
      status: r.status,
      headers: { ...BASE_HEADERS, ...(r.headers ?? {}) },
    });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/* ─────────────────────────────────────────────────────────── */

const CreateSchema = z.object({
  clientId: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
  storeId: z.string().optional(),     // used to compose channel
  registerId: z.string().optional(),  // used to compose channel
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    const T0 = Date.now();
    const marks: Array<[string, number]> = [];
    const mark = (label: string) => marks.push([label, Date.now() - T0]);

    try {
      const { organizationId } = ctx;

      const input = CreateSchema.parse(await req.json());
      mark("parse_body");

      /* 1) Resolve non-null desired country (payload → org settings → 'US') */
      const desiredCountry: string = await (async () => {
        if (input.country && input.country.length === 2) return input.country.toUpperCase();

        const { rows: org } = await pool.query(
          `SELECT countries, metadata FROM organizations WHERE id=$1`,
          [organizationId]
        );
        if (org.length) {
          const row = org[0];
          let first: string | null = null;

          if (Array.isArray(row.countries) && row.countries.length) first = row.countries[0];
          else if (typeof row.countries === "string") {
            try {
              const parsed = JSON.parse(row.countries);
              if (Array.isArray(parsed) && parsed.length) first = parsed[0];
            } catch {}
          }
          if (!first && row.metadata) {
            try {
              const m = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
              first = m?.defaultCountry || m?.country || null;
            } catch {}
          }
          if (first && typeof first === "string" && first.length === 2) return first.toUpperCase();
        }
        return "US";
      })();
      mark("country_resolve");

      /* 2) Resolve client (existing behaviour: default to Walk-in) */
      let clientId = input.clientId ?? null;
      if (!clientId) {
        const { rows } = await pool.query(
          `SELECT id
             FROM clients
            WHERE "organizationId"=$1
              AND (
                    LOWER(COALESCE("firstName", '')) = 'walk-in'
                 OR LOWER(COALESCE(username, '')) LIKE 'walkin-%'
                  )
         ORDER BY "createdAt" ASC
            LIMIT 1`,
          [organizationId]
        );
        if (!rows.length) {
          return {
            status: 400,
            body: { error: "clientId is required for POS cart" },
            headers: { "Server-Timing": 'm0;desc="parse_body"' },
          };
        }
        clientId = rows[0].id;
      }
      mark("client_resolve");

      /* 3) Compose a POS channel value that starts with "pos-" (index-friendly prefix) */
      let channelVal = "pos-";
      if (input.storeId || input.registerId) {
        const s = input.storeId ?? "na";
        const r = input.registerId ?? "na";
        channelVal = `pos-${s}-${r}`;
      }

      /* 4) Try to reuse an ACTIVE cart for this exact channel first */
      if (channelVal !== "pos-") {
        const { rows: exact } = await pool.query(
          `SELECT *
             FROM carts
            WHERE "clientId"=$1
              AND "organizationId"=$2
              AND status=true
              AND channel=$3
         ORDER BY "createdAt" DESC
            LIMIT 1`,
          [clientId, organizationId, channelVal]
        );
        if (exact.length) {
          const cart = exact[0];
          if ((cart.country || "").toUpperCase() !== desiredCountry) {
            await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [desiredCountry, cart.id]);
            cart.country = desiredCountry;
          }
          mark("reuse_exact");
          return {
            status: 201,
            body: { newCart: cart, reused: true },
            headers: { "Server-Timing": encodeServerTiming(marks) },
          };
        }
      }

      /* 5) Fallback: reuse any active POS cart (prefix LIKE 'pos-%'; faster than ILIKE) */
      const { rows: anyPos } = await pool.query(
        `SELECT *
           FROM carts
          WHERE "clientId"=$1
            AND "organizationId"=$2
            AND status=true
            AND channel LIKE 'pos-%'
       ORDER BY "createdAt" DESC
          LIMIT 1`,
        [clientId, organizationId]
      );
      if (anyPos.length) {
        const cart = anyPos[0];
        if (channelVal !== "pos-" && cart.channel === "pos-") {
          await pool.query(`UPDATE carts SET channel=$1 WHERE id=$2`, [channelVal, cart.id]);
          cart.channel = channelVal;
        }
        if ((cart.country || "").toUpperCase() !== desiredCountry) {
          await pool.query(`UPDATE carts SET country=$1 WHERE id=$2`, [desiredCountry, cart.id]);
          cart.country = desiredCountry;
        }
        mark("reuse_any_pos");
        return {
          status: 201,
          body: { newCart: cart, reused: true },
          headers: { "Server-Timing": encodeServerTiming(marks) },
        };
      }

      /* 6) Create the cart (no shipping method for walk-in POS) */
      const cartId = uuidv4();
      const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb924"; // sha256("")

      const insertSql = `
        INSERT INTO carts (
          id,"clientId",country,"couponCode","shippingMethod",
          "cartHash","cartUpdatedHash",status,"createdAt","updatedAt",
          "organizationId",channel
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW(),$8,$9)
        RETURNING *`;

      const vals = [
        cartId,                // $1 id
        clientId,              // $2 "clientId"
        desiredCountry,        // $3 country
        null,                  // $4 "couponCode" -> NULL
        null,                  // $5 "shippingMethod" -> NULL (POS walk-in)
        EMPTY_SHA256,          // $6 "cartHash"
        EMPTY_SHA256,          // $7 "cartUpdatedHash"
        organizationId,        // $8 "organizationId"
        channelVal,            // $9 channel
      ];

      const { rows: created } = await pool.query(insertSql, vals);
      mark("create_cart");

      return {
        status: 201,
        body: { newCart: created[0], reused: false },
        headers: { "Server-Timing": encodeServerTiming(marks) },
      };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return { status: 400, body: { error: err.errors } };
      }
      console.error("[POS POST /pos/cart] error:", err);
      return { status: 500, body: { error: "Internal server error" } };
    }
  });
}

/** Turn marks → Server-Timing header value */
function encodeServerTiming(marks: Array<[string, number]>): string {
  return marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");
}
