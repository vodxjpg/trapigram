import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* ------------------------------------------------------------------ *\
|  POST /api/tickets/messages/last                                     |
|                                                                      |
|  Body:  { "ticketIds": ["id‑1","id‑2", …] }                          |
|  Reply: { "last": { "<id‑1>": {id,isInternal,createdAt}, … } }       |
\* ------------------------------------------------------------------ */

export async function POST(req: NextRequest) {
  /* ① (auth / org scope) */
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  /* ② parse JSON */
  const { ticketIds = [] } = await req.json();
  if (!Array.isArray(ticketIds) || ticketIds.length === 0) {
    return NextResponse.json({ last: {} });
  }

  /* ③ one SQL round‑trip – DISTINCT ON trick gives us the newest row
         per ticketId in a single pass                                        */
  const { rows } = await pool.query(
    `SELECT DISTINCT ON ("ticketId")
            "ticketId", id, "isInternal", "createdAt"
       FROM "ticketMessages"
      WHERE "ticketId" = ANY($1::text[])
      ORDER BY "ticketId", "createdAt" DESC`,
    [ticketIds],
  );

  /* ④ shape -> { last: { ticketId: {…}, … } } */
  const map: Record<string, any> = {};
  for (const r of rows) {
    map[r.ticketId] = {
      id:         r.id,
      isInternal: r.isInternal,
      createdAt:  r.createdAt,
    };
  }
  return NextResponse.json({ last: map });
}

