// src/app/api/pos/cart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/** DB-backed idempotency (optional) */
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
  country: z.string().length(2).optional(), // allow explicit override from UI
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { organizationId } = ctx;
      const input = CreateSchema.parse(await req.json());

      /* 1) Resolve client (require an existing client; UI should already create Walk-in) */
      let clientId = input.clientId ?? null;

      if (!clientId) {
        // Try to find an existing Walk-in in this org
        const { rows: walk } = await pool.query(
          `SELECT id FROM clients
             WHERE "organizationId"=$1
               AND (COALESCE("isWalkIn",false)=true OR LOWER("firstName")='walk-in')
           ORDER BY "createdAt" ASC
            LIMIT 1`,
          [organizationId]
        );
        if (walk.length) {
          clientId = walk[0].id;
        } else {
          // Do NOT create a new client here (to avoid schema constraints & web flow side effects)
          return { status: 400, body: { error: "clientId is required for POS cart" } };
        }
      }

      // Validate client belongs to org
      const { rows: clientRows } = await pool.query(
        `SELECT id FROM clients WHERE id=$1 AND "organizationId"=$2`,
        [clientId, organizationId]
      );
      if (!clientRows.length) return { status: 404, body: { error: "Client not found" } };

      /* 2) Reuse only an ACTIVE POS cart (don’t touch web carts) */
      const { rows: active } = await pool.query(
        `SELECT * FROM carts
          WHERE "clientId"=$1 AND "organizationId"=$2 AND status=true AND channel='pos'
        ORDER BY "createdAt" DESC
           LIMIT 1`,
        [clientId, organizationId]
      );
      if (active.length) {
        return { status: 201, body: { newCart: active[0], reused: true } };
      }

      /* 3) Resolve NON-NULL country */
      const resolveCountry = async (): Promise<string> => {
        // a) explicit
        if (input.country && input.country.length === 2) return input.country.toUpperCase();

        // b) organization countries (first) or metadata default
        const { rows: org } = await pool.query(
          `SELECT countries, metadata FROM organizations WHERE id=$1`,
          [organizationId]
        );
        if (org.length) {
          const row = org[0];
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

        // c) hard fallback
        return "US";
      };

      const country = await resolveCountry();

      /* 4) Resolve a valid shippingMethod id (NOT NULL FK) */
      const resolveShippingMethodId = async (): Promise<string> => {
        // Try by org (if column exists); otherwise fall back to any record
        // Attempt 1: org-scoped
        try {
          const r1 = await pool.query(
            `SELECT id FROM "shippingMethods" WHERE "organizationId"=$1 ORDER BY "createdAt" ASC LIMIT 1`,
            [organizationId]
          );
          if (r1.rows.length) return r1.rows[0].id;
        } catch (e: any) {
          // 42703 → column doesn’t exist in this schema; ignore and try global
          if (e?.code !== "42703") throw e;
        }

        // Attempt 2: any method
        const r2 = await pool.query(
          `SELECT id FROM "shippingMethods" ORDER BY "createdAt" ASC LIMIT 1`
        );
        if (r2.rows.length) return r2.rows[0].id;

        throw new Error("No shipping method configured");
      };

      let shippingMethodId: string;
      try {
        shippingMethodId = await resolveShippingMethodId();
      } catch (e: any) {
        return { status: 400, body: { error: e?.message || "No shipping method available" } };
      }

      /* 5) Create the POS cart */
      const cartId = uuidv4();
      const emptySha256 = "e3b0c44298fc1c149afbf4c8996fb924"; // sha256("")

      const cols = [
        "id",
        "\"clientId\"",
        "country",
        "\"couponCode\"",
        "\"shippingMethod\"",
        "\"cartHash\"",
        "\"cartUpdatedHash\"",
        "status",
        "\"createdAt\"",
        "\"updatedAt\"",
        "\"organizationId\"",
        "channel",
      ];
      const vals: any[] = [
        cartId,
        clientId,
        country,
        null,                 // couponCode
        shippingMethodId,     // ✅ NOT NULL FK
        emptySha256,
        emptySha256,
        true,                 // status (active)
        new Date(),
        new Date(),
        organizationId,
        "pos",                // ✅ isolate POS carts
      ];
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
