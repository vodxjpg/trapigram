// src/app/api/payment-methods/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const paymentUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  active: z.boolean().optional(),
  apiKey: z.string().nullable().optional(),
  secretKey: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  instructions: z.string().nullable().optional(),
  default: z.boolean().optional(),
});

/** Next 15+ may pass params as a Promise */
type Ctx = { params: Promise<{ id: string }> };

/* =========================================================
   GET /api/payment-methods/[id]
   ========================================================= */
export async function GET(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;

  const { tenantId } = session as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 },
    );
  }

  try {
    const { id } = await ctx.params;
    const sql = `
      SELECT id, "tenantId", name, active, "apiKey", "secretKey",
             description, instructions, "default",
             "createdAt", "updatedAt"
        FROM "paymentMethods"
       WHERE id = $1 AND "tenantId" = $2
       LIMIT 1
    `;
    const { rows } = await pool.query(sql, [id, tenantId]);
    if (!rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("[GET /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* =========================================================
   PATCH /api/payment-methods/[id]
   body: any subset of fields from paymentUpdateSchema
   ========================================================= */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;

  const { tenantId } = session as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 },
    );
  }

  try {
    const { id } = await ctx.params;

    // Guard: tenant owns this id
    const owns = await pool.query(
      `SELECT id FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2`,
      [id, tenantId],
    );
    if (!owns.rowCount) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    const body = await req.json();
    const parsed = paymentUpdateSchema.parse(body);

    const entries = Object.entries(parsed);
    if (!entries.length) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, val] of entries) {
      updates.push(`"${key}" = $${i++}`); // quote reserved names like "default"
      values.push(val);
    }

    const sql = `
      UPDATE "paymentMethods"
         SET ${updates.join(", ")},
             "updatedAt" = NOW()
       WHERE id = $${i} AND "tenantId" = $${i + 1}
       RETURNING id, "tenantId", name, active, "apiKey", "secretKey",
                 description, instructions, "default",
                 "createdAt", "updatedAt"
    `;
    const { rows } = await pool.query(sql, [...values, id, tenantId]);
    if (!rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error("[PATCH /api/payment-methods/[id]]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* =========================================================
   DELETE /api/payment-methods/[id]
   - blocks delete if "default" = true
   ========================================================= */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const session = await getContext(req);
  if (session instanceof NextResponse) return session;

  const { tenantId } = session as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 },
    );
  }

  try {
    const { id } = await ctx.params;

    const {
      rows: [pm],
    } = await pool.query(
      `SELECT name, "default"
         FROM "paymentMethods"
        WHERE id = $1 AND "tenantId" = $2
        LIMIT 1`,
      [id, tenantId],
    );
    if (!pm) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }
    if (pm.default === true) {
      return NextResponse.json(
        { error: "Default payment methods cannot be deleted. Deactivate it instead." },
        { status: 400 },
      );
    }

    const del = await pool.query(
      `DELETE FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2 RETURNING name`,
      [id, tenantId],
    );
    if (!del.rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    const deletedName = (del.rows[0]?.name as string | undefined) ?? "Payment method";
    return NextResponse.json({ message: `${deletedName} deleted` });
  } catch (err) {
    console.error("[DELETE /api/payment-methods/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
