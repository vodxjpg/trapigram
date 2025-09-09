// src/app/api/payment-methods/[id]/active/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const bodySchema = z.object({
  active: z.boolean(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx as { tenantId: string | null };
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 }
    );
  }

  try {
    const { id } = params;

    const body = await req.json();
    const { active } = bodySchema.parse(body);

    // Ownership guard
    const owns = await pool.query(
      `SELECT id FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2`,
      [id, tenantId]
    );
    if (!owns.rowCount) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    const sql = `
      UPDATE "paymentMethods"
         SET active = $1,
             "updatedAt" = NOW()
       WHERE id = $2 AND "tenantId" = $3
       RETURNING id, name, active, "apiKey", "secretKey",
                 description, instructions, "default",
                 "tenantId", "createdAt", "updatedAt"
    `;
    const { rows } = await pool.query(sql, [active, id, tenantId]);
    if (!rows.length) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0], { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/payment-methods/[id]/active]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
