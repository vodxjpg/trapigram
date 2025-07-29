// src/app/api/tickets/[id]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { sendNotification, NotificationChannel } from "@/lib/notifications";
import { emit } from "@/lib/ticket-events";
import { publish } from "@/lib/pubsub";
import { pusher } from "@/lib/pusher-server";          // ★ NEW

/* ---------------- unchanged GET handler omitted for brevity ---------------- */

const messagesSchema = z.object({
  message: z.string().min(1, "Message is required."),
  attachments: z.string(),
  isInternal: z.boolean(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx;

  try {
    const { id } = await params;
    const raw = await req.json();

    const messageText =
      typeof raw.message === "string"
        ? raw.message.trim()
        : typeof raw.text === "string"
        ? raw.text.trim()
        : typeof raw.content === "string"
        ? raw.content.trim()
        : "";

    if (!messageText)
      return NextResponse.json({ error: "Message is required." }, { status: 400 });

    const attachmentsStr =
      typeof raw.attachments === "string"
        ? raw.attachments
        : JSON.stringify(raw.attachments ?? []);

    const isInternal =
      typeof raw.isInternal === "boolean"
        ? raw.isInternal
        : req.headers.get("x-is-internal") === "true";

    const parsed = messagesSchema.parse({
      message: messageText,
      attachments: attachmentsStr,
      isInternal,
    });

    /* ---------- insert DB row ---------- */
const msgId = uuidv4();
const { rows: [saved] } = await pool.query(/* … */);
saved.attachments = JSON.parse(saved.attachments);

/* ---------- realtime fan‑out ---------- */
await publish(`ticket:${id}`, saved);                       // Upstash (legacy)
await pusher.trigger(`ticket-${id}`, "new-message", saved); // Pusher (dashboard)
emit(id, saved);                                            // in‑process

/* ★★★★★ PUSH TO THE BOT ★★★★★ */
if (parsed.isInternal) {
  /* we need the ticket owner */
  const { rows: [{ clientid: clientId, title }] } =
    await pool.query(`SELECT "clientId", title FROM tickets WHERE id = $1 LIMIT 1`, [id]);

  await pusher.trigger(
    `org-${organizationId}-client-${clientId}`,
    "admin-message",                          // same event the bot already listens for
    {
      text: saved.message,
      ticketId: id,
      ticketTitle: title ?? "",
    },
  );
}
/* -------------------------------------------------------------------- */

const chan = `ticket_${id.replace(/-/g, "")}`;
await pool.query('SELECT pg_notify($1, $2)', [chan, JSON.stringify(saved)]);

    /* ---------- public reply notification ---------- */
    if (!parsed.isInternal) {
      const {
        rows: [{ clientId: orderClientId, country: clientCountry }],
      } = await pool.query(
        `SELECT t."clientId", c.country
           FROM tickets t
           JOIN clients c ON c.id = t."clientId"
          WHERE t.id = $1 LIMIT 1`,
        [id],
      );

      const channels: NotificationChannel[] = ["email", "in_app"];
      await sendNotification({
        organizationId,
        type: "ticket_replied",
        message: `Update on your ticket: <strong>${messageText}</strong>`,
        subject: `Reply on ticket #${id}`,
        variables: { ticket_number: id },
        channels,
        clientId: orderClientId,
        ticketId: id,
        country: clientCountry,
        url: `/tickets/${id}`,
      });
    }

    /* ---------- bump status on public reply ---------- */
    if (!parsed.isInternal) {
      const { rows: [{ count }] } = await pool.query(
        `SELECT COUNT(*) FROM "ticketMessages" WHERE "ticketId" = $1`,
        [id],
      );
      if (Number(count) > 1) {
        await pool.query(
          `UPDATE tickets SET status = 'in-progress' WHERE id = $1`,
          [id],
        );
      }
    }

    return NextResponse.json(saved, { status: 201 });
  } catch (err) {
    console.error("[POST /api/tickets/[id]/messages] error:", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
