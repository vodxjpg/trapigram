// src/lib/notification-outbox.ts
import { db } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { sendNotification, type NotificationChannel, type NotificationType } from "@/lib/notifications";

type OutboxRow = {
  id: string;
  organizationId: string;
  orderId?: string | null;
  type: NotificationType;
  trigger?: string | null;
  channel: NotificationChannel;
  payload: any;
  dedupeKey: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError?: string | null;
  status: "pending" | "sent" | "dead";
  createdAt: Date;
  updatedAt: Date;
};

export function makeDedupeKey(input: Record<string, any>) {
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(input, Object.keys(input).sort()));
  return h.digest("hex");
}

/** Enqueue one row per channel; idempotent by dedupeKey */
export async function enqueueNotificationFanout(opts: {
  organizationId: string;
  orderId?: string | null;
  type: NotificationType;
  trigger?: string | null;
  channels: NotificationChannel[];             // fan-out
  payload: {
    // the same fields you’d pass to sendNotification,
    // BUT WITHOUT 'channels' (we add per-row)
    message: string;
    subject?: string;
    variables?: Record<string, string>;
    country?: string | null;
    userId?: string | null;
    clientId?: string | null;
    url?: string | null;
    ticketId?: string | null;
  };
  dedupeSalt?: string;                         // e.g. "buyer" | "admin" | "supplier_admin"
}) {
  const rows: OutboxRow[] = [];
  for (const ch of opts.channels) {
    const dedupeKey = makeDedupeKey({
      org: opts.organizationId,
      order: opts.orderId ?? null,
      type: opts.type,
      trigger: opts.trigger ?? null,
      channel: ch,
      salt: opts.dedupeSalt ?? "",
      // include the identity of the target to avoid de-duping different recipients
      clientId: opts.payload.clientId ?? null,
      userId: opts.payload.userId ?? null,
      vars: opts.payload.variables ?? {},
    });

    rows.push({
      id: uuidv4(),
      organizationId: opts.organizationId,
      orderId: opts.orderId ?? null,
      type: opts.type,
      trigger: opts.trigger ?? null,
      channel: ch,
      payload: { ...opts.payload }, // stored once per channel
      dedupeKey,
      attempts: 0,
      maxAttempts: 8,
      nextAttemptAt: new Date(),
      lastError: null,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // upsert by dedupeKey (ignore if exists)
  for (const r of rows) {
    await db
      .insertInto("notificationOutbox")
      .values({
        id: r.id,
        organizationId: r.organizationId,
        orderId: r.orderId ?? null,
        type: r.type,
        trigger: r.trigger ?? null,
        channel: r.channel,
        payload: JSON.stringify(r.payload),
        dedupeKey: r.dedupeKey,
        attempts: r.attempts,
        maxAttempts: r.maxAttempts,
        nextAttemptAt: r.nextAttemptAt,
        lastError: r.lastError,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })
      .onConflict((oc) => oc.column("dedupeKey").doNothing())
      .execute();
  }
}

/** process up to `limit` due items; returns { done, sent } */
export async function drainNotificationOutbox(limit = 10) {
  const due = await db
    .selectFrom("notificationOutbox")
    .select([
      "id",
      "organizationId",
      "orderId",
      "type",
      "trigger",
      "channel",
      "payload",
      "attempts",
      "maxAttempts",
    ])
    .where("status", "=", "pending")
    .where("nextAttemptAt", "<=", new Date())
    .limit(limit)
    .execute();

  let sent = 0;

  for (const row of due) {
    const id = row.id as string;
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

    try {
      // send exactly one channel
      await sendNotification({
        organizationId: row.organizationId as string,
        type: row.type as NotificationType,
        trigger: (row.trigger as string | null) ?? null,
        channels: [row.channel as NotificationChannel],
        ...payload,
      });

      await db
        .updateTable("notificationOutbox")
        .set({
          status: "sent",
          updatedAt: new Date(),
          lastError: null,
        })
        .where("id", "=", id)
        .execute();

      // after a SUCCESS: mark “notifiedPaidOrCompleted” for paid/completed
      if (row.orderId && (row.type === "order_paid" || row.type === "order_completed")) {
        await db
          .updateTable("orders")
          .set({ notifiedPaidOrCompleted: true, updatedAt: new Date() })
          .where("id", "=", row.orderId as string)
          .execute();
      }

      sent++;
    } catch (err: any) {
      const attempts = (row.attempts as number) + 1;
      const base = 15000;                        // 15s base
      const max = 30 * 60 * 1000;                // cap: 30 minutes
      const backoff = Math.min(base * Math.pow(2, attempts - 1), max);
      const jitter = Math.floor(Math.random() * 5000); // +0..5s
      const next = new Date(Date.now() + backoff + jitter);

      await db
        .updateTable("notificationOutbox")
        .set({
          attempts,
          nextAttemptAt: next,
          updatedAt: new Date(),
          lastError: String(err?.message || err),
          status: attempts >= (row.maxAttempts as number) ? "dead" : "pending",
        })
        .where("id", "=", id)
        .execute();
    }
  }

  return { done: due.length, sent };
}
