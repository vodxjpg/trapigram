// src/app/api/order/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/**
 * POST /api/order/messages/last?clientId=<clientId>
 *
 * Body: { orderIds: string[] }
 * Response: { last: { [orderId]: { id, isInternal, createdAt } } }
 *
 * Returns, for each orderId, the **latest internal** message that has NOT
 * been acknowledged by the given client (see orderMessageReceipts).
 */
export async function POST(req: NextRequest) {
  /* ① auth / context ---------------------------------------------------- */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;          // auth failed → early exit

  /* ② parse inputs ------------------------------------------------------ */
  const { orderIds = [] } = await req.json().catch(() => ({}));
  const clientId = req.nextUrl.searchParams.get("clientId"); // mandatory

  if (!clientId) {
    return NextResponse.json(
      { error: "clientId query-param required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  /* ③ run query – NOT-EXISTS skips messages already in receipts --------- */
  const sql = `
    SELECT DISTINCT ON (om."orderId")
           om."orderId",
           om.id,
           om."isInternal",
           om."createdAt"
      FROM "orderMessages" om
     WHERE om."orderId" = ANY ($1::text[])
       AND om."isInternal"
       AND NOT EXISTS (
             SELECT 1
               FROM "orderMessageReceipts" r
              WHERE r."messageId" = om.id
                AND r."clientId"  = $2
           )
     ORDER BY om."orderId", om."createdAt" DESC
  `;
  const { rows } = await pool.query(sql, [orderIds, clientId]);

  /* ④ shape response ---------------------------------------------------- */
  const last: Record<string, { id: string; isInternal: boolean; createdAt: string }> = {};
  for (const r of rows) {
    last[r.orderId] = {
      id:         r.id,
      isInternal: r.isInternal,
      createdAt:  r.createdAt,
    };
  }
  return NextResponse.json({ last });
}
