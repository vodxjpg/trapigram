/* ------------------------------------------------------------------ *\
|  src/app/api/tickets/[id]/messages/route.ts                          |
|  /api/tickets/[id]/messages – create a new ticket message            |
|                                                                      |
|  • Persists the message in Postgres                                  |
|  • Broadcasts to dashboard / SSE / worker listeners                  |
|  • Sends internal (staff→user) replies to the Telegram bot           |
|  • Notifies the customer on public replies via e-mail + in-app       |
|  • Auto-bumps ticket status                                          |
\* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { sendNotification, NotificationChannel } from "@/lib/notifications";
import { emit } from "@/lib/ticket-events";
import { publish } from "@/lib/pubsub";
import { pusher } from "@/lib/pusher-server";

/* ---------------- (GET handler lives above – unchanged) ------------ */

/* ──────────────── validation schema ──────────────────────────────── */
const messagesSchema = z.object({
  message: z.string().min(1, "Message is required."),
  attachments: z.string(),     // JSON-stringified array
  isInternal: z.boolean(),
});

/* ───────────────────────── POST /messages ────────────────────────── */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  /* -------- auth / context -------- */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;          // early exit on auth error
  const { organizationId } = ctx;

  try {
    const { id: ticketId } = await params;
    const raw = await req.json();

    /* -------- normalise incoming fields -------- */
    const messageText =
      typeof raw.message === "string"
        ? raw.message.trim()
        : typeof raw.text === "string"
          ? raw.text.trim()
          : typeof raw.content === "string"
            ? raw.content.trim()
            : "";

    if (!messageText) {
      return NextResponse.json({ error: "Message is required." }, { status: 400 });
    }

    const attachmentsStr =
      typeof raw.attachments === "string"
        ? raw.attachments
        : JSON.stringify(raw.attachments ?? []);

    /* header fallback lets web-dashboard POST without tweaking JSON */
    const isInternal =
      typeof raw.isInternal === "boolean"
        ? raw.isInternal
        : req.headers.get("x-is-internal") === "true";

    const parsed = messagesSchema.parse({
      message: messageText,
      attachments: attachmentsStr,
      isInternal,
    });

    /* ------------------------------------------------------------------ */
    /* 1️⃣  Persist the message                                            */
    /* ------------------------------------------------------------------ */

    // ⬇️ place this right after the INSERT that returns `saved`
    await pool.query(
      `
      UPDATE tickets
        SET "lastMessageAt" = NOW(),
            "updatedAt"     = NOW(),
            -- if the reply is internal, auto-move to in-progress (unless already closed)
            status = CASE
                        WHEN $3::boolean AND status <> 'closed' THEN 'in-progress'
                        ELSE status
                      END
      WHERE id = $1
        AND "organizationId" = $2
      `,
      [ticketId, organizationId, parsed.isInternal]
    );

    const msgId = uuidv4();
    const {
      rows: [saved],
    } = await pool.query(
      `INSERT INTO "ticketMessages"
         (id,"ticketId",message,attachments,"isInternal","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       RETURNING *`,
      [msgId, ticketId, parsed.message, parsed.attachments, parsed.isInternal],
    );
    saved.attachments = JSON.parse(saved.attachments);   // convert back to JS

    /* ------------------------------------------------------------------ */
    /* 2️⃣  Realtime fan-out (dashboard & SSE consumers)                  */
    /* ------------------------------------------------------------------ */
    await publish(`ticket:${ticketId}`, saved);                       // Upstash
    await pusher.trigger(`ticket-${ticketId}`, "new-message", saved); // Dashboard
    emit(ticketId, saved);                                            // local event bus

    /* ------------------------------------------------------------------ */
    /* 3️⃣  Push *internal* replies to the customer’s Telegram bot       */
    /* ------------------------------------------------------------------ */
    if (parsed.isInternal) {
      const {
        rows: [{ clientId, title: ticketTitle }],
      } = await pool.query(
        `SELECT "clientId", title FROM tickets WHERE id = $1 LIMIT 1`,
        [ticketId],
      );

      await pusher.trigger(
        `org-${organizationId}-client-${clientId}`,
        "admin-message",
        {
          id: saved.id,
          text: saved.message,
          ticketId,
          ticketTitle,
          attachments: saved.attachments,
          createdAt: saved.createdAt,
        },
      );
    }

    /* ------------------------------------------------------------------ */
    /* 4️⃣  PostgreSQL NOTIFY – wake up any in-process workers            */
    /* ------------------------------------------------------------------ */
    const chan = `ticket_${ticketId.replace(/-/g, "")}`;
    await pool.query("SELECT pg_notify($1, $2)", [chan, JSON.stringify(saved)]);

    /* ------------------------------------------------------------------ */
    /* 5️⃣  Customer notification for *public* replies                    */
    /* ------------------------------------------------------------------ */
    if (!parsed.isInternal) {
      const {
        rows: [
          {
            clientId: ticketClientId,
            country: clientCountry,
            ticketKey,
          },
        ],
      } = await pool.query(
        `SELECT t."clientId", c.country, t."ticketKey"
           FROM tickets t
           JOIN clients c ON c.id = t."clientId"
          WHERE t.id = $1
          LIMIT 1`,
        [ticketId],
      );

      const channels: NotificationChannel[] = ["email", "in_app"];
      await sendNotification({
        organizationId,
        type: "ticket_replied",
        message: `Update on your ticket: <strong>${messageText}</strong>`,
        // Show the human ticket number in subjects
        subject: `Reply on ticket #${ticketKey}`,
        // Template placeholders
        variables: {
          ticket_number: String(ticketKey),
          ticket_content: messageText,
          ticket_id: ticketId, // back-compat
        },
        channels,
        clientId: ticketClientId,
        ticketId,
        country: clientCountry,
        url: `/tickets/${ticketId}`,
      });
    }

    /* ------------------------------------------------------------------ */
    /* 6️⃣  Auto-bump ticket status when *admin* (internal) replies       */
    /* ------------------------------------------------------------------ */
    if (parsed.isInternal) {
      await pool.query(
        `UPDATE tickets
            SET status = 'in-progress', "updatedAt" = NOW()
          WHERE id = $1
            AND status <> 'closed'`,
        [ticketId],
      );
    }

    /* ---------------- SUCCESS ---------------- */
    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    console.error("[POST /api/tickets/[id]/messages] error:", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
