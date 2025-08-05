import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/**
 * POST /api/tickets/messages/receipt?organizationId=…
 * Body: { messageIds: string[], clientId: string }
 *
 * Writes one row per (messageId, clientId).
 * Ignores duplicates (ON CONFLICT DO NOTHING).
 */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req.clone());
  if (ctx instanceof NextResponse) return ctx;

  const { messageIds = [], clientId } = await req.json().catch(() => ({}));
  if (!clientId || !Array.isArray(messageIds) || messageIds.length === 0)
    return NextResponse.json({ ok: false });

  await pool.query(
    `INSERT INTO "ticketMessageReceipts" ("messageId","clientId")
     SELECT * FROM UNNEST ($1::text[], $2::text[])
       ON CONFLICT DO NOTHING`,
    [messageIds, Array(messageIds.length).fill(clientId)],
  );

  return NextResponse.json({ ok: true });
}
