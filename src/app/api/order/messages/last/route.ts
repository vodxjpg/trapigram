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
  const clientId = req.nextUrl.searchParams.get("clientId");   // ← new
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT ON ("orderId")
            "orderId", id, "isInternal", "createdAt"
           FROM "orderMessages" om
${clientId ? `
     LEFT JOIN "orderMessageReceipts" r
            ON r."messageId" = om.id
           AND r."clientId"  = $2
` : ""}
    WHERE om."orderId" = ANY($1::text[])
      ${clientId ? "AND r.\"messageId\" IS NULL" : ""}
    ORDER BY om."orderId", om."createdAt" DESC`,
  clientId ? [orderIds, clientId] : [orderIds],
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
