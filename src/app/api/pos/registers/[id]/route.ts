// src/app/api/pos/registers/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const UpdateSchema = z.object({
  label: z.string().min(1).optional(),
  active: z.boolean().optional(),
  storeId: z.string().optional(), // allow moving a register to a different store
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM registers WHERE id=$1 AND "organizationId"=$2`,
      [id, organizationId]
    );
    if (!rows.length) return NextResponse.json({ error: "Register not found" }, { status: 404 });
    return NextResponse.json({ register: rows[0] }, { status: 200 });
  } catch (err: any) {
    console.error("[GET /pos/registers/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    const input = UpdateSchema.parse(await req.json());

    // If moving to another store, validate it belongs to same org
    if (input.storeId) {
      const { rows: s } = await pool.query(
        `SELECT id FROM stores WHERE id=$1 AND "organizationId"=$2`,
        [input.storeId, organizationId]
      );
      if (!s.length) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    }

    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (input.label !== undefined) {
      fields.push(`label=$${idx++}`); values.push(input.label);
    }
    if (input.active !== undefined) {
      fields.push(`active=$${idx++}`); values.push(input.active);
    }
    if (input.storeId !== undefined) {
      fields.push(`"storeId"=$${idx++}`); values.push(input.storeId);
    }
    if (!fields.length) return NextResponse.json({ ok: true }, { status: 200 });

    const sql = `UPDATE registers SET ${fields.join(", ")}, "updatedAt"=NOW()
                  WHERE id=$${idx} AND "organizationId"=$${idx + 1}
                  RETURNING *`;
    values.push(id, organizationId);
    const { rows } = await pool.query(sql, values);
    if (!rows.length) return NextResponse.json({ error: "Register not found" }, { status: 404 });
    return NextResponse.json({ register: rows[0] }, { status: 200 });
  } catch (err: any) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error("[PATCH /pos/registers/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id } = await params;

  try {
    const r = await pool.query(
      `DELETE FROM registers WHERE "organizationId"=$1 AND id=$2 RETURNING id`,
      [organizationId, id]
    );
    if (!r.rowCount) return NextResponse.json({ error: "Register not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error("[DELETE /pos/registers/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}