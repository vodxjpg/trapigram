// src/app/api/payment-methods/[id]/pos-visible/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const bodySchema = z.object({ posVisible: z.boolean() });
type Ctx = { params: Promise<{ id: string }> };

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
    const { posVisible } = bodySchema.parse(await req.json());

    // ownership guard
    const owns = await pool.query(
      `SELECT id FROM "paymentMethods" WHERE id = $1 AND "tenantId" = $2`,
      [id, tenantId],
    );
    if (!owns.rowCount) {
      return NextResponse.json({ error: "Payment method not found" }, { status: 404 });
    }

    const { rows } = await pool.query(
      `UPDATE "paymentMethods"
          SET "posVisible" = $1,
              "updatedAt"  = NOW()
        WHERE id = $2 AND "tenantId" = $3
        RETURNING id, name, active, "default", "posVisible",
                  "tenantId", "createdAt", "updatedAt"`,
      [posVisible, id, tenantId],
    );

    return NextResponse.json(rows[0], { status: 200 });
  } catch (err) {
    console.error("[PATCH /api/payment-methods/[id]/pos-visible]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
