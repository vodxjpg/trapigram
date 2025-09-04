// src/app/api/tickets/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { z } from "zod";
import { getContext } from "@/lib/context";

/* ---------- validation helpers ---------- */
const uuid = z.string().uuid("Invalid ticketId");

/* ---------- GET /api/tickets/[ticketId] ---------- */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;

    // ─────────────────────────────────────────────────────────────
    // Lazy close this ticket if the *last message* is > 24h ago
    // ─────────────────────────────────────────────────────────────
    await pool.query(
      `
      UPDATE tickets t
         SET status = 'closed', "updatedAt" = NOW()
       WHERE t.id = $1
         AND t."organizationId" = $2
         AND t.status <> 'closed'
         AND EXISTS (SELECT 1 FROM "ticketMessages" tm WHERE tm."ticketId" = t.id)
         AND (
           SELECT MAX(tm."createdAt") FROM "ticketMessages" tm
            WHERE tm."ticketId" = t.id
         ) < NOW() - INTERVAL '24 hours'
      `,
      [id, organizationId],
    );

    /* 3 · fetch ticket header + user name */
    const ticketQuery = `
    SELECT tickets.id,
           tickets."organizationId",
           tickets."clientId",
           clients."firstName",
           tickets.title,
           tickets.priority,
           tickets.status,
           tickets."createdAt"
    FROM   tickets
    JOIN   clients ON tickets."clientId" = clients.id
    WHERE  tickets.id = $1
      AND  tickets."organizationId" = $2
    LIMIT  1;
  `;
    const ticketVals = [id, organizationId];

    /* 4 · fetch messages for that ticket */
    const msgQuery = `
    SELECT id,
           "ticketId",
           message,
           attachments,
           "isInternal",
           "createdAt"
    FROM   "ticketMessages"
    WHERE  "ticketId" = $1
    ORDER  BY "createdAt" ASC;
  `;

    const tRes = await pool.query(ticketQuery, ticketVals);
    if (tRes.rows.length === 0)
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    const ticket = tRes.rows[0];

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
