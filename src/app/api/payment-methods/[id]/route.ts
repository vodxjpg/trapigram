// src/app/api/payment-methods/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

// ────────── validation schema ──────────
const paymentUpdateSchema = z.object({
  name:      z.string().min(1, { message: "Name is required." }),
  active:    z.boolean(),
  apiKey:    z.string().nullable().optional(),
  secretKey: z.string().nullable().optional(),
});

type Params = { params: Promise<{ id: string }> };   // ← note Promise

// ────────── GET /api/payment-methods/[id] ──────────
export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;                     // ← await here
    const sql = `
      SELECT id, "tenantId", name, active, "apiKey", "secretKey",
             "createdAt", "updatedAt"
      FROM "paymentMethods"
      WHERE id = $1
    `;
    const result = await pool.query(sql, [id]);
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(result.rows[0]);
  } catch (err) {
    console.error("[GET /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ────────── PATCH /api/payment-methods/[id] ──────────
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;                     // ← await here too
    const body   = await req.json();
    const parsed = paymentUpdateSchema.parse(body);

    const updates: string[] = [];
    const values: any[] = [];
    let idx = 1;

    for (const [key, val] of Object.entries(parsed)) {
      updates.push(`"${key}" = $${idx++}`);
      values.push(val);
    }
    if (!updates.length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    values.push(id);

    const sql = `
      UPDATE "paymentMethods"
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${idx}
      RETURNING *
    `;
    const res = await pool.query(sql, values);
    if (!res.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(res.rows[0]);
  } catch (err: any) {
    console.error("[PATCH /api/payment-methods/[id]]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ────────── DELETE /api/payment-methods/[id] ──────────
export async function DELETE(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;                     // ← await here too
    const sql = `
      DELETE FROM "paymentMethods"
      WHERE id = $1
      RETURNING *
    `;
    const res = await pool.query(sql, [id]);
    if (!res.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json({ message: "Payment method deleted" });
  } catch (err) {
    console.error("[DELETE /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
