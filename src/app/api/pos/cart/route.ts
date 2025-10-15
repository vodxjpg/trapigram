// src/app/api/pos/cart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/** Util: optional DB-backed idempotency (table: idempotency) */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const { status, body } = await exec();
    return NextResponse.json(body, { status });
  }
  const method = req.method;
  const path = new URL(req.url).pathname;

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt")
         VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key = $1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) {
          return NextResponse.json(rows[0].response, { status: rows[0].status });
        }
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const { status, body } = await exec();
        return NextResponse.json(body, { status });
      }
      throw e;
    }

    const { status, body } = await exec();
    await c.query(
      `UPDATE idempotency
         SET status = $2, response = $3, "updatedAt" = NOW()
       WHERE key = $1`,
      [key, status, body]
    );
    await c.query("COMMIT");
    return NextResponse.json(body, { status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

const CreateSchema = z.object({
  clientId: z.string().min(1).optional(),
  storeId: z.string().min(1).optional(),
  registerId: z.string().min(1).optional(),
  country: z.string().length(2).optional(), // ✅ allow explicit country from client
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { organizationId } = ctx;
      const input = CreateSchema.parse(await req.json());

      // 1) Resolve client
      let clientId = input.clientId ?? null;

      if (!clientId) {
        // Prefer a pre-existing "Walk-in" client if one exists,
        // otherwise require clientId (UI should have created walk-in already).
        const { rows: walk } = await pool.query(
          `SELECT id FROM clients
             WHERE "organizationId"=$1
               AND (LOWER("firstName")='walk-in' OR COALESCE("isWalkIn",false)=true)
           ORDER BY "createdAt" ASC
            LIMIT 1`,
          [organizationId]
        );
        if (walk.length) {
          clientId = walk[0].id;
        } else {
          return { status: 400, body: { error: "clientId is required" } };
        }
      }

      // Ensure client exists & belongs to org
      const { rows: clientRows } = await pool.query(
        `SELECT id FROM clients WHERE id=$1 AND "organizationId"=$2`,
        [clientId, organizationId]
      );
      if (!clientRows.length) {
        return { status: 404, body: { error: "Client not found" } };
      }

      // 2) Reuse active cart, if any
      const { rows: active } = await pool.query(
        `SELECT * FROM carts
           WHERE "clientId"=$1 AND "organizationId"=$2 AND status=true
         ORDER BY "createdAt" DESC
            LIMIT 1`,
        [clientId, organizationId]
      );
      if (active.length) {
        return { status: 201, body: { newCart: active[0], reused: true } };
      }

      // 3) Resolve NON-NULL cart.country
      const resolveCountry = async (): Promise<string> => {
        // a) explicit from payload
        if (input.country && input.country.length === 2) return input.country.toUpperCase();

        // b) from store.address.country if storeId provided
        if (input.storeId) {
          const { rows: s } = await pool.query(
            `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
            [input.storeId, organizationId]
          );
          const fromStore =
            s[0]?.address?.country ??
            s[0]?.address?.Country ??
            s[0]?.address?.COUNTRY ??
            null;
          if (fromStore && typeof fromStore === "string" && fromStore.length === 2) {
            return fromStore.toUpperCase();
          }
        }

        // c) from organization configured countries (first)
        const { rows: org } = await pool.query(
          `SELECT countries, metadata FROM organizations WHERE id=$1`,
          [organizationId]
        );

        if (org.length) {
          const row = org[0];
          // cases:
          // - countries is text[] (pg array)
          // - countries is json/JSONB string
          // - metadata JSON with defaultCountry/country
          let first: string | null = null;

          if (Array.isArray(row.countries) && row.countries.length) {
            first = row.countries[0];
          } else if (typeof row.countries === "string") {
            try {
              const parsed = JSON.parse(row.countries);
              if (Array.isArray(parsed) && parsed.length) first = parsed[0];
            } catch { /* ignore */ }
          }

          if (!first && row.metadata) {
            try {
              const m = typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata;
              first = m?.defaultCountry || m?.country || null;
            } catch { /* ignore */ }
          }

          if (first && typeof first === "string" && first.length === 2) {
            return first.toUpperCase();
          }
        }

        // d) hard default
        return "US";
      };

      const country = await resolveCountry();

      // 4) Insert new cart
      const cartId = uuidv4();
      const initialHash = "e3b0c44298fc1c149afbf4c8996fb924"; // sha256("")

      const cols: string[] = [
        "id",
        "\"organizationId\"",
        "\"clientId\"",
        "country",
        "\"couponCode\"",
        "\"shippingMethod\"",
        "\"cartHash\"",
        "\"cartUpdatedHash\"",
        "status",
        "\"createdAt\"",
        "\"updatedAt\"",
      ];
      const vals: any[] = [
        cartId,
        organizationId,
        clientId,
        country,           // ✅ guaranteed non-null
        null,              // couponCode
        null,              // shippingMethod
        initialHash,
        initialHash,
        true,
        new Date(),
        new Date(),
      ];

      // Optionally attach store/register if columns exist in your schema
      // We'll add defensively; if the columns do not exist, DB will error — so only push if you have them.
      if (input.storeId) {
        cols.push("\"storeId\"");
        vals.push(input.storeId);
      }
      if (input.registerId) {
        cols.push("\"registerId\"");
        vals.push(input.registerId);
      }

      // Build placeholders dynamically
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(",");

      const sql = `INSERT INTO carts (${cols.join(",")}) VALUES (${placeholders}) RETURNING *`;
      const { rows: created } = await pool.query(sql, vals);

      return { status: 201, body: { newCart: created[0], reused: false } };
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return { status: 400, body: { error: err.errors } };
      }
      console.error("[POS POST /pos/cart] error:", err);
      return { status: 500, body: { error: "Internal server error" } };
    }
  });
}
