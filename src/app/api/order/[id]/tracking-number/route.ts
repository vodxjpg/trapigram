// src/app/api/order/[id]/tracking-number/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    const { trackingNumber, shippingCompany } = await req.json();

    // Set tracking fields AND force status → completed (once), safely (no string concat)
    const sql = `
      UPDATE orders
         SET "trackingNumber" = $1,
             "shippingService" = $2,
             status = 'completed',
             "dateCompleted" = COALESCE("dateCompleted", NOW()),
             "updatedAt" = NOW()
       WHERE id = $3
         AND "organizationId" = $4
       RETURNING id, status, "trackingNumber", "shippingService"
    `;
    const { rows } = await pool.query(sql, [
      trackingNumber ?? null,
      shippingCompany ?? null,
      id,
      organizationId,
    ]);
    if (!rows.length) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json(rows[0], { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/order/:id/tracking-number]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}