// src/app/api/order/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/**
 * POST /api/order/messages/last?clientId=…
 *
 * Body: { orderIds: string[] }
 * Returns: { last: { [orderId]: { id, isInternal, createdAt } } }
 *
 * For every orderId, we give back the newest *internal* message that
 * the given client has **not** acknowledged yet (no row in
 * orderMessageReceipts for that <messageId,clientId> pair).
 */
export async function POST(req: NextRequest) {
  /* ① auth ------------------------------------------------------------ */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  /* ② inputs ---------------------------------------------------------- */
  const { orderIds = [] } = await req.json().catch(() => ({}));
  const clientId = req.nextUrl.searchParams.get("clientId");

  if (!clientId) {
    return NextResponse.json(
      { error: "clientId query-param required" },
      { status: 400 },
    );
  }
  if (!Array.isArray(orderIds) || orderIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  /* ③ query ----------------------------------------------------------- */
  const sql = `
    SELECT DISTINCT ON (om."orderId")
           om."orderId",
           om.id,
           om."isInternal",
           om."createdAt"
      FROM "orderMessages"           om
 LEFT JOIN "orderMessageReceipts"    r
        ON  r."messageId" = om.id
        AND r."clientId"  = $2            -- only for *this* client
     WHERE om."orderId"   = ANY ($1::text[])
       AND om."isInternal"
       AND r."messageId"  IS NULL         -- ✨ not yet acknowledged
  ORDER BY om."orderId", om."createdAt" DESC
  `;
  const { rows } = await pool.query(sql, [orderIds, clientId]);

  /* ④ shape ----------------------------------------------------------- */
  const last: Record<
    string,
    { id: string; isInternal: boolean; createdAt: string }
  > = {};
  for (const r of rows) {
    last[r.orderId] = {
      id:         r.id,
      isInternal: r.isInternal,
      createdAt:  r.createdAt,
    };
  }
  return NextResponse.json({ last });
}
