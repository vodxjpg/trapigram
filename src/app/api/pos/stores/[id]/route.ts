// src/app/api/pos/stores/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.record(z.any()).optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM stores WHERE id=$1 AND "organizationId"=$2`,
      [id, organizationId]
    );
    if (!rows.length) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({ store: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /pos/stores/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    const body = UpdateSchema.parse(await req.json());
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (body.name !== undefined) { fields.push(`name=$${idx++}`); values.push(body.name); }
    if (body.address !== undefined) { fields.push(`address=$${idx++}`); values.push(body.address); }
    if (!fields.length) return NextResponse.json({ ok: true }, { status: 200 });

    const sql = `UPDATE stores SET ${fields.join(", ")}, "updatedAt"=NOW()
                  WHERE id=$${idx} AND "organizationId"=$${idx + 1}
                  RETURNING *`;
    values.push(id, organizationId);
    const { rows } = await pool.query(sql, values);
    if (!rows.length) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({ store: rows[0] }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error("[PATCH /pos/stores/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    // Remove child registers first (avoids FK violations)
    await c.query(`DELETE FROM registers WHERE "organizationId"=$1 AND "storeId"=$2`, [
      organizationId,
      id,
    ]);
    const r = await c.query(
      `DELETE FROM stores WHERE "organizationId"=$1 AND id=$2 RETURNING id`,
      [organizationId, id]
    );
    await c.query("COMMIT");
    if (!r.rowCount) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    await c.query("ROLLBACK");
    console.error("[DELETE /pos/stores/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    c.release();
  }
}
