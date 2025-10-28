// src/app/api/pos/registers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import withIdempotency from "@/lib/idempotency";

const CreateSchema = z.object({
  storeId: z.string().min(1),
  name: z.string().min(1),
  active: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const url = new URL(req.url);
    const storeId = url.searchParams.get("storeId");

    let sql = `SELECT r.* FROM registers r
               JOIN stores s ON s.id = r."storeId"
              WHERE r."organizationId"=$1`;
    const vals: any[] = [organizationId];
    if (storeId) {
      sql += ` AND r."storeId"=$2`;
      vals.push(storeId);
    }
    sql += ` ORDER BY r."createdAt" DESC`;

    const { rows } = await pool.query(sql, vals);
    return NextResponse.json({ registers: rows }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /pos/registers]", err);
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

      // Validate store ownership
      const { rows: s } = await pool.query(
        `SELECT id FROM stores WHERE id=$1 AND "organizationId"=$2`,
        [input.storeId, organizationId]
      );
      if (!s.length) {
        return NextResponse.json({ error: "Store not found" }, { status: 404 });
      }

      const id = uuidv4();
      const { rows } = await pool.query(
        `INSERT INTO registers
          (id,"organizationId","storeId",name,active,"createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
        RETURNING *`,
        [
          id,
          organizationId,
          input.storeId,
          input.name,
          input.active,
        ]
      );
      return NextResponse.json({ register: rows[0] }, { status: 201 });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: err.errors }, { status: 400 });
      }
      console.error("[POST /pos/registers]", err);
      return NextResponse.json(
        { error: err.message ?? "Internal server error" },
        { status: 500 }
      );
    }
  });
}
