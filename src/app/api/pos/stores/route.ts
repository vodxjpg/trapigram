// src/app/api/pos/stores/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/** Idempotency (POST) */
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
  name: z.string().min(1),
  address: z.record(z.any()).optional(), // free-form address blob
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM stores WHERE "organizationId"=$1 ORDER BY "createdAt" DESC`,
      [organizationId]
    );
    return NextResponse.json({ stores: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /pos/stores]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  return withIdempotency(req, async () => {
    try {
      const input = CreateSchema.parse(await req.json());
      const id = uuidv4();

      const { rows } = await pool.query(
        `INSERT INTO stores
          (id,"organizationId",name,address,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,NOW(),NOW())
         RETURNING *`,
        [id, organizationId, input.name, input.address ?? {}]
      );

      return { status: 201, body: { store: rows[0] } };
    } catch (err: any) {
      if (err instanceof z.ZodError) return { status: 400, body: { error: err.errors } };
      console.error("[POST /pos/stores]", err);
      return { status: 500, body: { error: err.message ?? "Internal server error" } };
    }
  });
}
