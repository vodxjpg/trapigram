import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { z } from "zod";
import { getContext } from "@/lib/context";

export const runtime = "nodejs";

/* ---------- validation helpers ---------- */
const uuid = z.string().uuid("Invalid ticketId");

/* ---------- GET /api/tickets/[ticketId] ---------- */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // ⬅️ Next 16
) {
  const { id: rawId } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const parse = uuid.safeParse(rawId);
    if (!parse.success) {
      return NextResponse.json(
        { error: parse.error.issues[0].message },
        { status: 400 }
      );
    }
    const id = parse.data;

    // Lazy close if lastMessageAt > 24h
    await pool.query(
      `
      UPDATE tickets
         SET status = 'closed',
             "updatedAt" = NOW()
       WHERE id = $1
         AND "organizationId" = $2
         AND status <> 'closed'
         AND "lastMessageAt" < NOW() - INTERVAL '24 hours'
      `,
      [id, organizationId]
    );

    // Ticket header + client name
    const ticketQuery = `
      SELECT t.id,
             t."organizationId",
             t."clientId",
             c."firstName",
             t.title,
             t.priority,
             t.status,
             t."ticketKey",
             t."createdAt"
        FROM tickets t
        JOIN clients c ON t."clientId" = c.id
       WHERE t.id = $1
         AND t."organizationId" = $2
       LIMIT 1;
    `;
    const tRes = await pool.query(ticketQuery, [id, organizationId]);
    if (tRes.rows.length === 0) {
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }
    const ticket = tRes.rows[0];

    // Messages
    const msgQuery = `
      SELECT id,
             "ticketId",
             message,
             attachments,
             "isInternal",
             "createdAt"
        FROM "ticketMessages"
       WHERE "ticketId" = $1
       ORDER BY "createdAt" ASC;
    `;
    const mRes = await pool.query(msgQuery, [id]);
    const messages = mRes.rows.map((m) => ({
      ...m,
      attachments: m.attachments ? JSON.parse(m.attachments) : [],
    }));

    return NextResponse.json({ ticket, messages });
  } catch (err) {
    console.error("[GET /api/tickets/:id]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
