// src/app/api/pos/cart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, { status: r.status });
  }
  const method = req.method;
  const path = new URL(req.url).pathname;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt") VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

const CreateSchema = z.object({
  clientId: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
  // accepted but not stored (schema lacks columns) – useful later for analytics
  storeId: z.string().optional(),
  registerId: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { organizationId } = ctx;
      const input = CreateSchema.parse(await req.json());

      // 1) resolve client (must already exist; UI creates/chooses Walk-in)
      let clientId = input.clientId ?? null;
      if (!clientId) {
        const { rows } = await pool.query(
          `SELECT id FROM clients
            WHERE "organizationId"=$1
              AND (COALESCE("isWalkIn",false)=true OR LOWER("firstName")='walk-in')
           ORDER BY "createdAt" ASC
            LIMIT 1`,
          [organizationId]
        );
        if (!rows.length) return { status: 400, body: { error: "clientId is required for POS cart" } };
        clientId = rows[0].id;
      }

      // 2) reuse ACTIVE POS cart only (do not touch web carts)
      const { rows: active } = await pool.query(
        `SELECT * FROM carts
          WHERE "clientId"=$1 AND "organizationId"=$2 AND status=true AND channel='pos'
          ORDER BY "createdAt" DESC
          LIMIT 1`,
        [clientId, organizationId]
      );
      if (active.length) return { status: 201, body: { newCart: active[0], reused: true } };

      // 3) resolve non-null country (payload -> org -> 'US')
      const country = await (async () => {
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
          if (first && first.length === 2) return first.toUpperCase();
        }
        return "US";
      })();

      // 4) shipping method for POS must be '-' (FK). Require it to exist.
      const dash = await pool.query(
        `SELECT id FROM "shippingMethods" WHERE id='-' AND ("organizationId"=$1 OR "organizationId" IS NULL) LIMIT 1`,
        [organizationId]
      );
      if (!dash.rowCount) {
        return {
          status: 400,
          body: { error: "POS requires a shipping method with id '-' (create one called e.g. 'POS — No Shipping')." },
        };
      }
      const shippingMethodId = dash.rows[0].id; // '-'

      // 5) create cart
      const cartId = uuidv4();
      const emptyHash = "e3b0c44298fc1c149afbf4c8996fb924";
      const { rows: created } = await pool.query(
        `INSERT INTO carts (
           id,"clientId",country,"couponCode","shippingMethod",
           "cartHash","cartUpdatedHash",status,"createdAt","updatedAt",
           "organizationId",channel
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,true,NOW(),NOW(),$8,$9)
         RETURNING *`,
        [
          cartId,
          clientId,
          country,
          null,
          shippingMethodId,            // '-'
          emptyHash,
          emptyHash,
          organizationId,
          "pos",                       // keep constraint happy
        ]
      );

      return { status: 201, body: { newCart: created[0], reused: false } };
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      console.error("[POS POST /pos/cart] error:", err);
      return { status: 500, body: { error: "Internal server error" } };
    }
  });
}
