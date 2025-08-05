// src/app/api/tickets/messages/last/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type LastMsg = {
  id:         string;
  message:    string;
  isInternal: boolean;
  createdAt:  string;
};

/**
 * POST /api/tickets/messages/last?clientId=…
 * Body:  { ticketIds: string[] }
 * Reply: { last: { [ticketId]: LastMsg } }
 */
export async function POST(req: NextRequest) {
  /* ① auth */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  /* ② inputs */
  const { ticketIds = [] } = await req.json().catch(() => ({}));
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId)
    return NextResponse.json({ error: "clientId query-param required" }, { status: 400 });
  if (!Array.isArray(ticketIds) || ticketIds.length === 0)
    return NextResponse.json({ last: {} });

  /* ③ query –- SAME idea as for orders, but ticket tables */
  const sql = `
    SELECT DISTINCT ON (tm."ticketId")
           tm."ticketId",
           tm.id,
           tm.message,
           tm."isInternal",
           tm."createdAt"
      FROM "ticketMessages"            tm
 LEFT JOIN "ticketMessageReceipts"     r
        ON  r."messageId" = tm.id
        AND r."clientId"  = $2
     WHERE tm."ticketId"  = ANY ($1::text[])
       AND tm."isInternal"
       AND r."messageId"  IS NULL
  ORDER BY tm."ticketId", tm."createdAt" DESC
  `;
  const { rows } = await pool.query(sql, [ticketIds, clientId]);

  /* ④ shape → { last: { … } } */
  const last: Record<string, LastMsg> = {};
  for (const r of rows) {
    last[r.ticketId] = {
      id:         r.id,
      message:    r.message,
      isInternal: r.isInternal,
      createdAt:  r.createdAt,
    };
  }
  return NextResponse.json({ last });
}
