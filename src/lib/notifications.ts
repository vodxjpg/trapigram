// src/lib/notifications.ts
"use server";

import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

/** ──────────────────────────────────────────────────────────────
 * Keep this list in sync everywhere (forms, API routes, etc.)
 * ──────────────────────────────────────────────────────────── */
export type NotificationType =
  | "order_placed"
  | "order_paid"
  | "order_completed"
  | "order_ready"
  | "order_cancelled"
  | "order_refunded"          // ← NEW

export type NotificationChannel =
  | "email"
  | "in_app"
  | "webhook"
  | "telegram";

export interface SendNotificationParams {
  organizationId: string;
  type: NotificationType;
  message: string;                                // fallback body
  subject?: string;                               // fallback subject
  variables?: Record<string, string>;
  country?: string | null;
  trigger?: string | null;
  channels: NotificationChannel[];
  userId?: string | null;                         // explicit admin target
  clientId?: string | null;                       // explicit user/client target
}

/* ───────────────── helpers ───────────────── */
const applyVars = (txt: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`{${k}}`, "g"), v),
    txt,
  );

/** HTML → Telegram-safe subset (<b>, <i>, <u>, <s>, <code>, <br>, etc.) */
const toTelegramHtml = (html: string) =>
  html
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*strong\s*>/gi, "<b>")
    .replace(/<\s*\/\s*strong\s*>/gi, "</b>")
    .replace(/<\s*em\s*>/gi, "<i>")
    .replace(/<\s*\/\s*em\s*>/gi, "</i>")
    .trim();

const pickTemplate = (
  role: "admin" | "user",
  country: string | null,
  templates: {
    role: "admin" | "user";
    subject: string | null;
    message: string;
    countries: string;
  }[],
) => {
  const exact = templates.find((t) => {
    if (t.role !== role) return false;
    const arr: string[] = Array.isArray(t.countries)
      ? (t.countries as unknown as string[])
      : JSON.parse(t.countries || "[]");
    return country ? arr.includes(country) : arr.length === 0;
  });
  if (exact) return exact;

  return templates.find(
    (t) => t.role === role && JSON.parse(t.countries || "[]").length === 0,
  );
};

/* ───────────────── main dispatcher ───────────────── */
export async function sendNotification(params: SendNotificationParams) {
  const {
    organizationId,
    type,
    message,
    subject,
    variables = {},
    country = null,
    trigger = null,
    channels,
    userId = null,
    clientId = null,
  } = params;

  /* 1️⃣ templates */
  const templates = await db
    .selectFrom("notificationTemplates")
    .select(["role", "subject", "message", "countries"])
    .where("organizationId", "=", organizationId)
    .where("type", "=", type)
    .execute();

  const tplUser  = pickTemplate("user",  country, templates);
  const tplAdmin = pickTemplate("admin", country, templates);

  const hasUserTpl  = !!tplUser;
  const hasAdminTpl = !!tplAdmin;

  /* 2️⃣ subjects & bodies (with variable substitution) */
  const subjectUser  = (tplUser?.subject  || subject || type).trim().replace(/_/g, " ");
  const subjectAdmin = (tplAdmin?.subject || subject || type).trim().replace(/_/g, " ");

  const bodyUser  = applyVars(tplUser?.message  || message, variables);
  const bodyAdmin = applyVars(tplAdmin?.message || message, variables);

  /* 3️⃣ e-mail targets */
  const adminEmails: string[] = [];
  const userEmails:  string[] = [];

  /* explicit admin */
  if (userId) {
    const u = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (u?.email) adminEmails.push(u.email);
  }

  /* owners */
  const ownerRows = await db
    .selectFrom("member")
    .select(["userId"])
    .where("organizationId", "=", organizationId)
    .where("role", "=", "owner")
    .execute();
  if (ownerRows.length) {
    const ownerIds = ownerRows.map((r) => r.userId);
    const owners = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "in", ownerIds)
      .execute();
    owners.forEach((o) => o.email && adminEmails.push(o.email));
  }

  /* client */
  let clientRow: { email: string | null; userId: string | null } | null = null;
  if (clientId) {
    clientRow = await db
      .selectFrom("clients")
      .select(["email", "userId"])
      .where("id", "=", clientId)
      .executeTakeFirst();
    if (clientRow?.email) userEmails.push(clientRow.email);
  }

  /* fallback support e-mail */
  if (!adminEmails.length) {
    const sup = await db
      .selectFrom("organizationSupportEmail")
      .select(["email"])
      .where("organizationId", "=", organizationId)
      .$if(country !== null, (q) => q.where("country", "=", country!))
      .orderBy("isGlobal desc")
      .limit(1)
      .executeTakeFirst();
    if (sup?.email) adminEmails.push(sup.email);
  }

  /* 4️⃣ master log */
  await db
    .insertInto("notifications")
    .values({
      id: uuidv4(),
      organizationId,
      type,
      trigger,
      message: bodyUser,
      channels: JSON.stringify(channels),
      country,
      targetUserId: userId,
      targetClientId: clientId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  /* 5️⃣ channel fan-out — respect template presence */
  /* — EMAIL — */
  if (channels.includes("email")) {
    const promises: Promise<unknown>[] = [];
    if (hasAdminTpl)
      promises.push(
        ...adminEmails.map((addr) =>
          sendEmail({ to: addr, subject: subjectAdmin, text: bodyAdmin }),
        ),
      );
    if (hasUserTpl)
      promises.push(
        ...userEmails.map((addr) =>
          sendEmail({ to: addr, subject: subjectUser, text: bodyUser }),
        ),
      );
    await Promise.all(promises);
  }

  /* — IN-APP (only if a user template exists) — */
  if (channels.includes("in_app") && hasUserTpl) {
    await dispatchInApp({
      organizationId,
      userId,
      clientId,
      message: bodyUser,
      country,
    });
  }

  /* — WEBHOOK — always fires */
  if (channels.includes("webhook")) {
    await dispatchWebhook({ organizationId, type, message: bodyUser });
  }

  /* — TELEGRAM — */
  if (channels.includes("telegram")) {
    await dispatchTelegram({
      organizationId,
      type,
      country,
      bodyAdmin: hasAdminTpl ? bodyAdmin : "",
      bodyUser: hasUserTpl ? bodyUser : "",
      adminUserIds: [],             // owners reach via groups
      clientUserId: clientRow?.userId || null,
    });
  }
}

/* ───────── in-app & webhook helpers (unchanged) ───────── */
async function dispatchInApp(opts: {
  organizationId: string;
  userId: string | null;
  clientId: string | null;
  message: string;
  country: string | null;
}) {
  const { organizationId, userId, clientId, message, country } = opts;
  await db
    .insertInto("inAppNotifications")
    .values({
      id: uuidv4(),
      organizationId,
      userId,
      clientId,
      title: message.slice(0, 64),
      message,
      country,
      read: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();
}

async function dispatchWebhook(opts: {
  organizationId: string;
  type: string;
  message: string;
}) {
  const { organizationId, type, message } = opts;
  const rows = await db
    .selectFrom("organizationPlatformKey")
    .select(["apiKey"])
    .where("organizationId", "=", organizationId)
    .where("platform", "=", "webhook")
    .execute();
  await Promise.all(
    rows.map((r) =>
      fetch(r.apiKey, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, message }),
      }).catch(() => null),
    ),
  );
}

async function dispatchTelegram(opts: {
  organizationId: string;
  type: string;
  country: string | null;
  bodyAdmin: string;
  bodyUser: string;
  adminUserIds: string[];
  clientUserId: string | null;
}) {
  const {
    organizationId,
    country,
    bodyAdmin,
    bodyUser,
    adminUserIds,
    clientUserId,
  } = opts;

  /* 1. bot token */
  const row = await db
    .selectFrom("organizationPlatformKey")
    .select(["apiKey"])
    .where("organizationId", "=", organizationId)
    .where("platform", "=", "telegram")
    .executeTakeFirst();
  if (!row) return;

  const BOT = `https://api.telegram.org/bot${row.apiKey}/sendMessage`;

  /* 2. groups */
  const groupRows = await db
    .selectFrom("notificationGroups")
    .select(["groupId", "countries"])
    .where("organizationId", "=", organizationId)
    .execute();

  const groupIds = groupRows
    .filter((g) => {
      const arr: string[] = Array.isArray(g.countries)
        ? (g.countries as unknown as string[])
        : JSON.parse(g.countries || "[]");
      return country ? arr.includes(country) : true;
    })
    .map((g) => g.groupId);

  /* 3. targets (skip roles w/o template) */
  const targets: { chatId: string; text: string }[] = [];

  if (bodyAdmin.trim()) {
    const safeAdmin = toTelegramHtml(bodyAdmin);
    targets.push(
      ...adminUserIds.map((id) => ({ chatId: id, text: safeAdmin })),
      ...groupIds.map((id) => ({ chatId: id, text: safeAdmin })),
    );
  }

  if (clientUserId && bodyUser.trim()) {
    targets.push({ chatId: clientUserId, text: toTelegramHtml(bodyUser) });
  }

  await Promise.all(
    targets.map((t) =>
      fetch(BOT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: t.chatId,
          text: t.text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }).catch(() => null),
    ),
  );
}
