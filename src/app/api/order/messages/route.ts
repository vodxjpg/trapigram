// src/app/api/order/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function POST(req: NextRequest) {
  /* ① give getContext its own copy  */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  /* ② now _our_ copy is still intact */
  const { orderIds = [] } = await req.json();
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT ON ("orderId")
            "orderId", id, "isInternal", "createdAt"
       FROM "orderMessages"
      WHERE "orderId" = ANY($1::text[])
      ORDER BY "orderId", "createdAt" DESC`,
    [orderIds],
  );

  const map: Record<string, any> = {};
  for (const r of rows) {
    map[r.orderId] = {
      id:         r.id,
      isInternal: r.isInternal,
      createdAt:  r.createdAt,
    };
  }
  return NextResponse.json({ last: map });
}
