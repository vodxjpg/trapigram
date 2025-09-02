// src/app/api/payment-methods/[id]/route.ts

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

// ---------------------- Zod schemas ----------------------
const paymentUpdateSchema = z.object({
  active: z.boolean(),
});

type Params = { params: { id: string } };

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx;
  if (!tenantId) {
    return NextResponse.json(
      { error: "No tenant found for the current credentials" },
      { status: 404 }
    );
  }

  try {
    // keep parity with existing style across the codebase
    const { id } = await params as any;

    // validate body
    const body = await req.json();
    const { active } = paymentUpdateSchema.parse(body);

    // ownership guard
    const owns = await pool.query(
      `SELECT id FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2`,
      [id, tenantId]
    );
    if (!owns.rowCount) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 }
      );
    }

    // update (tenant-scoped)
    const sql = `
      UPDATE "paymentMethods"
         SET active = $1,
             "updatedAt" = NOW()
       WHERE id = $2
         AND "tenantId" = $3
       RETURNING id, name, active, "apiKey", "secretKey", "tenantId", "createdAt", "updatedAt"
    `;
    const res = await pool.query(sql, [active, id, tenantId]);

    if (!res.rows.length) {
      return NextResponse.json(
        { error: "Payment method not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(res.rows[0], { status: 200 });
  } catch (err: any) {
    console.error("[PATCH /api/payment-methods/[id]]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
