// src/app/api/order/[id]/messages/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { sendNotification, NotificationChannel } from "@/lib/notifications";
import { publish, lpushRecent } from "@/lib/pubsub";
import { pusher } from "@/lib/pusher-server";

const messagesSchema = z.object({
  message: z.string().min(1, { message: "Message is required." }),
  clientId: z.string(),
  isInternal: z.boolean(),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;
    const since = req.nextUrl.searchParams.get("since");

    const baseSQL = `
      SELECT om.id, om."orderId", om."clientId", om.message,
             om."isInternal", om."createdAt", c.email
        FROM "orderMessages" om
        JOIN clients c ON c.id = om."clientId"
       WHERE om."orderId" = $1
    `;
    const args: any[] = [id];
    if (since) args.push(since);

    const { rows } = await pool.query(
      baseSQL +
      (since ? ` AND om."createdAt" > $2` : "") +
      ` ORDER BY om."createdAt" ASC`,
      args,
    );

    return NextResponse.json({ messages: rows }, { status: 200 });
  } catch (err) {
    console.error("[GET /api/order/:id/messages]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId, userId } = ctx;

  try {
    const { id } = params;
    const isInternal = req.headers.get("x-is-internal") === "true";
    const raw = await req.json();
    const { message, clientId } = messagesSchema.parse({ ...raw, isInternal });

    const msgId = uuidv4();

    // Save the message
    const {
      rows: [saved],
    } = await pool.query(
      `INSERT INTO "orderMessages"(id,"orderId","clientId",message,"isInternal","createdAt")
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [msgId, id, clientId, message, isInternal],
    );

    // Enrich with client email (handy for dashboards / notifications)
    const {
      rows: [cliInfo],
    } = await pool.query(
      `SELECT email FROM clients WHERE id = $1 LIMIT 1`,
      [clientId],
    );
    const event = { ...saved, email: cliInfo?.email ?? null };

    /* ── realtime fan-out ─────────────────────────────────────────── */
    // Upstash pub/sub for order thread listeners (UI, etc.)
    await publish(`order:${id}`, event);

    // Keep a warm replay buffer (per order)
    await lpushRecent(`order:${id}:recent`, event, 50, 7 * 24 * 3600);

    // Mirror to your external UI via Pusher
    await pusher.trigger(`order-${id}`, "new-message", event);

    /* Push INTERNAL admin replies straight to the Telegram bot */
    if (isInternal) {
      // Lookup orderKey once (good for bot + replay lists)
      const {
        rows: [ordInfo],
      } = await pool.query(
        `SELECT "orderKey" FROM orders WHERE id = $1 LIMIT 1`,
        [id],
      );

      const botPayload = {
        id: saved.id,
        text: message,
        orderId: id,
        orderKey: ordInfo?.orderKey,
        createdAt: saved.createdAt,
      };

      // Realtime ping to the bot’s Pusher channel
      await pusher.trigger(
        `org-${organizationId}-client-${clientId}`,
        "admin-message",
        botPayload,
      );

      // Optional: also keep a per-client recent list (handy for future catch-up UIs)
      await lpushRecent(
        `orders:client:${clientId}:recent`,
        { ...event, orderKey: ordInfo?.orderKey },
        50,
        7 * 24 * 3600,
      );
    }

    /* ── notifications (unchanged) ───────────────────────────────── */
    if (!isInternal) {
      const {
        rows: [ord],
      } = await pool.query(
        `SELECT "orderKey","clientId", country FROM orders WHERE id = $1 LIMIT 1`,
        [id],
      );
      const { orderKey, clientId: orderClientId, country: orderCountry } = ord;
      const {
        rows: [cli],
      } = await pool.query(`SELECT "userId" FROM clients WHERE id = $1 LIMIT 1`, [
        orderClientId,
      ]);

      const customerSent = cli?.userId === userId;
      const channels: NotificationChannel[] = ["email", "in_app"];

      await sendNotification({
        organizationId,
        type: "order_message",
        message: customerSent
          ? `New message from customer on order <strong>#${orderKey}</strong>: ${message}`
          : `Update on your order <strong>#${orderKey}</strong>: ${message}`,
        subject: customerSent
          ? `Customer message on order #${orderKey}`
          : `Reply regarding order #${orderKey}`,
        variables: { order_number: orderKey },
        channels,
        clientId: customerSent ? null : orderClientId,
        country: orderCountry,
        url: `/orders/${id}`,
      });
    }

    return NextResponse.json({ messages: event }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/order/:id/messages]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
