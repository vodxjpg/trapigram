// src/app/api/order/[id]/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/**
 * Lightweight endpoint —
 * returns ONLY the most‑recent message meta for an order.
 *
 * Shape:
 *   { last: { id, isInternal, createdAt } | null }
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);               // auth / org check
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = params;
    const {
      rows: [last],
    } = await pool.query(
      `SELECT id, "isInternal", "createdAt"
         FROM "orderMessages"
        WHERE "orderId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [id],
    );

    return NextResponse.json({ last: last ?? null }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/order/:id/messages/last]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
