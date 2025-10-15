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
      // unique violation -> return stored result
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key = $1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) {
          return NextResponse.json(rows[0].response, { status: rows[0].status });
        }
        // fallback if not found
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      // table missing -> no-op idempotency
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const { status, body } = await exec();
        return NextResponse.json(body, { status });
      }
      throw e;
    }

    // We hold the key; execute once
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
  // If not provided, we'll use (or create) a per-organization "Walk-In" client.
  clientId: z.string().min(1).optional(),
  // Optionally associate to a store/register (if your schema supports it).
  storeId: z.string().min(1).optional(),
  registerId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { organizationId } = ctx;
      const input = CreateSchema.parse(await req.json());

      // Resolve client (selected or Walk-In)
      let clientId = input.clientId ?? null;

      if (!clientId) {
        // Ensure a per-organization Walk-In client exists (no email).
        const { rows: ex } = await pool.query(
          `SELECT id FROM clients WHERE "organizationId"=$1 AND "isWalkIn"=true LIMIT 1`,
          [organizationId]
        );
        if (ex.length) {
          clientId = ex[0].id;
        } else {
          const walkId = uuidv4();
          // Try to pick a default level & country; fall back to 'default'
          const [{ rows: levelRows }, { rows: orgRows }] = await Promise.all([
            pool.query(
              `SELECT id FROM "clientLevels" WHERE "organizationId"=$1 ORDER BY "rank" NULLS LAST, "createdAt" LIMIT 1`,
              [organizationId]
            ),
            pool.query(`SELECT COALESCE(metadata->>'country','default') AS country FROM organizations WHERE id=$1`, [
              organizationId,
            ]),
          ]);
          const levelId = levelRows[0]?.id ?? "default";
          const country = orgRows[0]?.country ?? "default";

          await pool.query(
            `INSERT INTO clients
              (id,"organizationId",name,email,country,"levelId","isWalkIn","createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW())`,
            [walkId, organizationId, "Walk-In", null, country, levelId]
          );
          clientId = walkId;
        }
      }

      // Check an active cart for this client (POS separate channel can still reuse carts table)
      const { rows: active } = await pool.query(
        `SELECT * FROM carts WHERE "clientId"=$1 AND status=true ORDER BY "createdAt" DESC LIMIT 1`,
        [clientId]
      );
      if (active.length) {
        return { status: 201, body: { newCart: active[0], reused: true } };
      }

      // Build initial cart
      // Country/level come from client
      const { rows: crows } = await pool.query(
        `SELECT country,"levelId" FROM clients WHERE id=$1`,
        [clientId]
      );
      if (!crows.length) return { status: 404, body: { error: "Client not found" } };

      const cartId = uuidv4();
      const initialHash = "e3b0c44298fc1c149afbf4c8996fb924" /* sha256("") */;

      // Base insert (shippingMethod generally null for POS)
      const baseCols = [
        `id`, `"clientId"`, `country`, `"couponCode"`, `"shippingMethod"`,
        `"cartHash"`, `"cartUpdatedHash"`, `status`, `"createdAt"`, `"updatedAt"`, `"organizationId"`
      ];
      const baseVals = [
        cartId, clientId, crows[0].country, null, null,
        initialHash, initialHash, true, `NOW()`, `NOW()`, organizationId
      ];
      let placeholders = baseVals.map((_, i) => `$${i + 1}`).join(",");

      // Optionally attach store/register if your schema has those columns
      if (input.storeId) {
        baseCols.push(`"storeId"`);
        baseVals.push(input.storeId);
        placeholders += `,$${baseVals.length}`;
      }
      if (input.registerId) {
        baseCols.push(`"registerId"`);
        baseVals.push(input.registerId);
        placeholders += `,$${baseVals.length}`;
      }

      const insertSql = `INSERT INTO carts (${baseCols.join(",")}) VALUES (${placeholders}) RETURNING *`;
      const { rows: created } = await pool.query(insertSql, baseVals);

      return { status: 201, body: { newCart: created[0], reused: false } };
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      console.error("[POS POST /pos/cart] error:", err);
      return { status: 500, body: { error: "Internal server error" } };
    }
  });
}
