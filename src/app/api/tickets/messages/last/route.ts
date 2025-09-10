import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* ------------------------------------------------------------------ *\
|  POST /api/tickets/messages/last?clientId=…                          |
|                                                                      |
|  Body:  { ticketIds: string[] }                                      |
|  Reply: { last: { [ticketId]: { id,message,isInternal,createdAt } } }|
\* ------------------------------------------------------------------ */

type LastMsg = {
  id: string;
  message: string;
  isInternal: boolean;
  createdAt: string;
};

export async function POST(req: NextRequest) {
  /* ① auth */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  /* ② inputs */
  const { ticketIds = [] } = await req.json().catch(() => ({}));
  const clientId = req.nextUrl.searchParams.get("clientId");
  if (!clientId)
    return NextResponse.json({ error: "clientId required" }, { status: 400 });
  if (!Array.isArray(ticketIds) || ticketIds.length === 0)
    return NextResponse.json({ last: {} });

  /* ③ query – skip messages already acknowledged by this client */
  const sql = `
    SELECT DISTINCT ON (tm."ticketId")
           tm."ticketId",
           tm.id,
           tm.message,
           tm."isInternal",
           tm."createdAt"
      FROM "ticketMessages"          tm
 LEFT JOIN "ticketMessageReceipts"  r
        ON r."messageId" = tm.id
       AND r."clientId"  = $2             -- current client
     WHERE tm."ticketId" = ANY ($1::text[])
       AND tm."isInternal"
       AND r."messageId" IS NULL          -- unseen only
  ORDER BY tm."ticketId", tm."createdAt" DESC
  `;
  const { rows } = await pool.query(sql, [ticketIds, clientId]);

  /* ④ shape → object */
  const last: Record<string, LastMsg> = {};
  for (const r of rows) {
    last[r.ticketId] = {
      id: r.id,
      message: r.message,
      isInternal: r.isInternal,
      createdAt: r.createdAt,
    };
  }
  return NextResponse.json({ last });
}
