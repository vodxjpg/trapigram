// src/app/api/order/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function POST(req: NextRequest) {
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  const { orderIds = [] } = await req.json();
  const clientId = req.nextUrl.searchParams.get("clientId");   // may be null
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  /* ── 1) build SQL – keep NOT-EXISTS variant only when clientId is present ── */
  const sql = `
    SELECT DISTINCT ON (om."orderId")
           om."orderId",
           om.id,
           om."isInternal",
           om."createdAt"
      FROM "orderMessages" om
     WHERE om."orderId" = ANY($1::text[])
       AND om."isInternal"
       ${clientId ? `AND NOT EXISTS (
                        SELECT 1
                          FROM "orderMessageReceipts" r
                         WHERE r."messageId" = om.id
                           AND r."clientId"  = $2
                     )` : ""}
     ORDER BY om."orderId", om."createdAt" DESC
  `;

  /* ── 2) run the query ─────────────────────────────────────────────────── */
  const { rows } = await pool.query(
    sql,
    clientId ? [orderIds, clientId] : [orderIds],
  );

  /* ── 3) shape the response exactly as before ──────────────────────────── */
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
