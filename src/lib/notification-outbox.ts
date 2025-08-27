// src/lib/notification-outbox.ts
import { db } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import {
  sendNotification,
  type NotificationChannel,
  type NotificationType,
} from "@/lib/notifications";

type OutboxRow = {
  id: string; // TEXT (not uuid)
  organizationId: string; // TEXT in DB
  orderId?: string | null; // UUID (orders.id) or null
  type: NotificationType;
  trigger?: string | null;
  channel: NotificationChannel;
  payload: any; // stored as JSONB
  dedupeKey: string; // unique idempotency key
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: Date;
  lastError?: string | null;
  status: "pending" | "sent" | "dead";
  createdAt: Date;
  updatedAt: Date;
};

export function makeDedupeKey(input: Record<string, any>) {
  // Stable hash over a sorted-key JSON to avoid accidental mismatches
  const h = crypto.createHash("sha256");
  h.update(JSON.stringify(input, Object.keys(input).sort()));
  return h.digest("hex");
}

/**
 * Enqueue one row per channel; idempotent by dedupeKey.
 * - Outbox `id` is a TEXT string (prefixed to avoid looking like a UUID).
 * - `organizationId` is treated as TEXT end-to-end (no casting).
 * - `payload` is persisted as JSONB.
 */
export async function enqueueNotificationFanout(opts: {
  organizationId: string;
  orderId?: string | null;
  type: NotificationType;
  trigger?: string | null;
  channels: NotificationChannel[]; // fan-out
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
  dedupeSalt?: string; // e.g. "buyer" | "admin" | "supplier_admin"
}) {
  const rows: OutboxRow[] = [];

  for (const ch of opts.channels) {
     // For admin-only triggers we normalize salt so multiple admin code paths
 // (e.g., "merchant_admin:paid" vs "store_admin:paid") collapse into one
 // dedupe identity per (org, order, type, trigger, channel, message).
 const normalizedSalt =
   (opts.trigger ?? "") === "admin_only" ? "admin" : (opts.dedupeSalt ?? "");
   // NEW: for admin_only + (order_paid|order_completed) we use a STABLE, payload-agnostic key
// so different code paths with slightly different messages/vars still dedupe correctly.
const isAdminOnlyOrder =
  (opts.trigger ?? "") === "admin_only" &&
  (opts.type === "order_paid" || opts.type === "order_completed") &&
  Boolean(opts.orderId);
const dedupeKey = isAdminOnlyOrder
  ? // payload-agnostic stable key (works across processes/instances)
    `admin:${opts.organizationId}:${opts.orderId}:${opts.type}:${ch}`
  : // original content-hash key for all other cases
    makeDedupeKey({
      org: opts.organizationId,
      order: opts.orderId ?? null,
      type: opts.type,
      trigger: opts.trigger ?? null,
      channel: ch,
      salt: normalizedSalt,
      clientId: opts.payload.clientId ?? null,
      userId: opts.payload.userId ?? null,
      vars: opts.payload.variables ?? {},
      // keep the key compact – message/subject can be large but meaningful to dedupe by
      subject: opts.payload.subject ?? "",
      message: opts.payload.message ?? "",
        });

    rows.push({
      id: `out_${uuidv4()}`, // TEXT id (visibly non-UUID)
      organizationId: opts.organizationId,
      orderId: opts.orderId ?? null,
      type: opts.type,
      trigger: opts.trigger ?? null,
      channel: ch,
      payload: { ...opts.payload }, // will be stored as JSONB
      dedupeKey,
      attempts: 0,
      maxAttempts: 8,
      nextAttemptAt: new Date(),
      lastError: null,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

     // DEBUG: show what we intend to enqueue (one per channel)
 console.log("[outbox.enqueue] prepared", {
   id_preview: rows[rows.length - 1].id,
   org: opts.organizationId,
   order: opts.orderId ?? null,
   type: opts.type,
   trigger: opts.trigger ?? null,
   channel: ch,
   dedupeKey,
   // don't print payload body (can be large); show small meta instead
   hasSubject: Boolean(opts.payload.subject),
   hasVars: Boolean(opts.payload.variables && Object.keys(opts.payload.variables!).length),
   salt: opts.dedupeSalt ?? "",
   saltNormalized: normalizedSalt,
   dedupeStrategy: isAdminOnlyOrder ? "stable-admin-order" : "hash",
 });

  }

  // Upsert by dedupeKey (ignore if exists) – one row per channel
  for (const r of rows) {
    const res = await db
      .insertInto("notificationOutbox")
      .values({
        id: r.id, // TEXT
        organizationId: r.organizationId, // TEXT
        orderId: r.orderId ?? null, // UUID or null
        type: r.type,
        trigger: r.trigger ?? null,
        channel: r.channel,
        // Pass the object so PG stores JSONB; our drain handles both string/object just in case.
        payload: r.payload,
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
        // We can't rely on insert result for "did nothing" with all drivers; check existence for clarity.
  const existing = await db
    .selectFrom("notificationOutbox")
    .select(["id", "status", "attempts"])
    .where("dedupeKey", "=", r.dedupeKey)
    .where("channel", "=", r.channel)
    .execute();
  console.log("[outbox.enqueue] upsert result", {
    channel: r.channel,
    dedupeKey: r.dedupeKey,
    matchedCount: existing.length,
    ids: existing.map((e) => e.id),
    statuses: existing.map((e) => e.status),
    attempts: existing.map((e) => e.attempts),
  });
  }
}

/** Process up to `limit` due items; returns { done, sent } */
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
      "dedupeKey",
    ])
    .where("status", "=", "pending")
    .where("nextAttemptAt", "<=", new Date())
    .limit(limit)
    .execute();
     console.log("[outbox.drain] fetched due", { count: due.length, limit });
  let sent = 0;

  for (const row of due) {
    const id = row.id as string;
    // Cope with historical rows where payload may have been stringified
    const payload =
      typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;

    try {
        console.log("[outbox.drain] sending", {
    id,
    org: row.organizationId,
    order: row.orderId ?? null,
    type: row.type,
    trigger: row.trigger ?? null,
    channel: row.channel,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    dedupeKey: (row as any).dedupeKey,
  });
      // Send exactly one channel
      await sendNotification({
        organizationId: row.organizationId as string, // TEXT
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
        console.log("[outbox.drain] marked sent", { id });
      // After a SUCCESS: mark “notifiedPaidOrCompleted” for paid/completed
      if (
        row.orderId &&
        (row.type === "order_paid" || row.type === "order_completed")
      ) {
        await db
          .updateTable("orders")
          .set({ notifiedPaidOrCompleted: true, updatedAt: new Date() })
          .where("id", "=", row.orderId as string)
          .execute();
            console.log("[outbox.drain] set orders.notifiedPaidOrCompleted", {
    orderId: row.orderId,
    type: row.type,
  });
      }

      sent++;
    } catch (err: any) {
      const attempts = (row.attempts as number) + 1;
      const base = 15_000; // 15s base
      const max = 30 * 60 * 1000; // cap: 30 minutes
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
          console.warn("[outbox.drain] send failed", {
    id,
    channel: row.channel,
    attempts,
    nextAttemptAt: next.toISOString(),
    error: String(err?.message || err),
  });
    }
  }

  return { done: due.length, sent };
}
