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
  | "order_cancelled"
  | "order_refunded"
  | "order_partially_paid"
  | "order_shipped"
  | "ticket_created"
  | "ticket_replied"
  | "order_message";

export type NotificationChannel = "email" | "in_app" | "webhook" | "telegram";

export interface SendNotificationParams {
  organizationId: string;
  type: NotificationType;
  message: string;
  subject?: string;
  variables?: Record<string, string>;
  country?: string | null;
  trigger?: string | null;
  channels: NotificationChannel[];
  userId?: string | null;
  clientId?: string | null;
  url?: string | null;
  ticketId?: string | null;
}

/* ───────────────── helpers ───────────────── */
const applyVars = (txt: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`{${k}}`, "g"), v),
    txt,
  );

/** stripTags – quick server-side HTML removal */
const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");

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
    url = null,
    ticketId = null,
  } = params;

  /* enrich variables (tracking link) */
  if (variables.tracking_number) {
    const tn = variables.tracking_number;
    variables.tracking_number = `${tn}<br>https://www.ordertracker.com/track/${tn}`;
  }

  /* 1️⃣ templates */
  const templates = await db
    .selectFrom("notificationTemplates")
    .select(["role", "subject", "message", "countries"])
    .where("organizationId", "=", organizationId)
    .where("type", "=", type)
    .execute();

  const tplUser = pickTemplate("user", country, templates);
  const tplAdmin = pickTemplate("admin", country, templates);
  const hasUserTpl = !!tplUser;
  const hasAdminTpl = !!tplAdmin;

    // Decide fan-out based on trigger  template presence
  const suppressAdminFanout = trigger === "user_only_email";
  const suppressUserFanout  = trigger === "admin_only";
  const shouldAdminFanout   = !suppressAdminFanout && hasAdminTpl;
  const shouldUserFanout    = !suppressUserFanout; // user can still receive fallback content

  /* 2️⃣ subjects & bodies – generic (all channels) */
  const makeRawSub = (
    tplSubject: string | null | undefined,
    fallback: string | undefined,
  ) =>
    !tplSubject && !fallback
      ? type.replace(/_/g, " ")
      : (tplSubject || fallback || "").trim();

  const rawSubUser = makeRawSub(tplUser?.subject, subject);
  const rawSubAdm = makeRawSub(tplAdmin?.subject, subject);

  const subjectUserGeneric = applyVars(rawSubUser, variables);
  const subjectAdminGeneric = applyVars(rawSubAdm, variables);
  const bodyUserGeneric = applyVars(tplUser?.message || message, variables);
  const bodyAdminGeneric = applyVars(tplAdmin?.message || message, variables);

  /* 2️⃣-bis subjects & bodies – e-mail only (product list hidden) */
  const varsEmail = {
    ...variables,
    product_list:
      "Due to privacy reasons you can only see the product list in your order details page or message notification by the API",
  };

  const subjectUserEmail = applyVars(rawSubUser, varsEmail);
  const subjectAdminEmail = applyVars(rawSubAdm, varsEmail);
  const bodyUserEmail = applyVars(tplUser?.message || message, varsEmail);
  const bodyAdminEmail = applyVars(tplAdmin?.message || message, varsEmail);

  /* 3️⃣ support e-mail (for CC and admin fallback) */
  const supportRow = await db
    .selectFrom("organizationSupportEmail")
    .select(["email"])
    .where("organizationId", "=", organizationId)
    .$if(country !== null, (q) => q.where("country", "=", country!))
    .orderBy("isGlobal desc")
    .limit(1)
    .executeTakeFirst();
  const supportEmail = supportRow?.email || null;

  /* 4️⃣ e-mail targets */
  const adminEmails: string[] = [];
  const userEmails: string[] = [];

  if (userId) {
    const u = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (u?.email) adminEmails.push(u.email);
  }

  const ownerRows = await db
    .selectFrom("member")
    .select(["userId"])
    .where("organizationId", "=", organizationId)
    .where("role", "=", "owner")
    .execute();
  const ownerIds = ownerRows.map((r) => r.userId);
  if (ownerIds.length) {
    const owners = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "in", ownerIds)
      .execute();
    owners.forEach((o) => o.email && adminEmails.push(o.email));
  }

  let clientRow: { email: string | null; userId: string | null } | null = null;
  if (clientId) {
    clientRow = await db
      .selectFrom("clients")
      .select(["email", "userId"])
      .where("id", "=", clientId)
      .executeTakeFirst();
    if (clientRow?.email) userEmails.push(clientRow.email);
  }

  if (!adminEmails.length && supportEmail) adminEmails.push(supportEmail);

  /* 5️⃣ master log */
  await db
    .insertInto("notifications")
    .values({
      id: uuidv4(),
      organizationId,
      type,
      trigger,
      message: bodyUserGeneric,
      channels: JSON.stringify(channels),
      country,
      targetUserId: userId,
      targetClientId: clientId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();



  /* 6️⃣ channel fan-out */
  /* — EMAIL — */
  if (channels.includes("email")) {
    const send = ({
      to,
      subject,
      html,
      text,
      cc,
    }: {
      to: string;
      subject: string;
      html: string;
      text: string;
      cc?: string | null;
    }) => sendEmail({ to, subject, html, text, ...(cc ? { cc } : {}) });

    const promises: Promise<unknown>[] = [];

    if (adminEmails.length && shouldAdminFanout) {
      promises.push(
        ...adminEmails.map((addr) =>
          send({
            to: addr,
            subject: subjectAdminEmail,
            html: bodyAdminEmail,
            text: bodyAdminEmail.replace(/<[^>]+>/g, ""),
          }),
        ),
      );
    }

    if (userEmails.length && shouldUserFanout) {
      promises.push(
        ...userEmails.map((addr) =>
          send({
            to: addr,
            subject: subjectUserEmail,
            html: bodyUserEmail,
            text: bodyUserEmail.replace(/<[^>]+>/g, ""),
            cc: supportEmail,
          }),
        ),
      );
    }

    await Promise.all(promises);
  }

  /* — IN-APP — */
  if (channels.includes("in_app")) {
    const targets = new Set<string | null>();
    // user-facing
    if (shouldUserFanout) {
      if (userId) targets.add(userId);
      if (clientRow?.userId) targets.add(clientRow.userId);
    }
    // admin-facing (owners) → only if there is an admin template
    if (shouldAdminFanout) {
      ownerIds.forEach((id) => targets.add(id));
    }
    for (const uid of targets) {
      await dispatchInApp({
        organizationId, userId: uid, clientId, message: bodyUserGeneric, country, url,
      });
    }
  }

  /* — WEBHOOK — */
  if (channels.includes("webhook")) {
    if (shouldAdminFanout) {
      await dispatchWebhook({ organizationId, type, message: bodyUserGeneric });
    }
  }

  /* — TELEGRAM — */
  if (channels.includes("telegram")) {
    // 🔧 Only post to admin groups on admin-only triggers.
    // Buyer-facing notifications will DM the client (if linked) but won't hit groups,
    // which prevents the duplicate Telegram pings you observed.
    const wantAdminGroups = trigger === "admin_only";
    const wantClientDM = !suppressUserFanout; // i.e., not admin_only

    const bodyAdminOut = wantAdminGroups && hasAdminTpl ? bodyAdminGeneric : "";

   const bodyUserOut = wantClientDM ? bodyUserGeneric : "";

    await dispatchTelegram({
      organizationId,
      type,
      country,
      bodyAdmin: bodyAdminOut,
      bodyUser: bodyUserOut,
      adminUserIds: [], // keep as-is; groups handle admin broadcast
      clientUserId: wantClientDM ? clientRow?.userId || null : null,
      ticketId,
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
  url?: string | null;
}) {
  const { organizationId, userId, clientId, message, country, url } = opts;
  const plain = stripTags(message).replace(/\s+/g, " ").trim();
  await db
    .insertInto("inAppNotifications")
    .values({
      id: uuidv4(),
      organizationId,
      userId,
      clientId,
      title: plain.slice(0, 64),
      message,
      country,
      url: url ?? null,
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
  ticketId?: string | null;
}) {
  const {
    organizationId,
    country,
    bodyAdmin,
    bodyUser,
    adminUserIds,
    clientUserId,
    ticketId,
    type,
  } = opts;

  const row = await db
    .selectFrom("organizationPlatformKey")
    .select(["apiKey"])
    .where("organizationId", "=", organizationId)
    .where("platform", "=", "telegram")
    .executeTakeFirst();
  if (!row) return;

  const BOT = `https://api.telegram.org/bot${row.apiKey}/sendMessage`;

  const groupRows = await db
    .selectFrom("notificationGroups")
    .select(["groupId", "countries"])
    .where("organizationId", "=", organizationId)
    .execute();

  const orderGroupIds = groupRows
    .filter((g) => {
      const arr: string[] = Array.isArray(g.countries)
        ? (g.countries as unknown as string[])
        : JSON.parse(g.countries || "[]");
      return country ? arr.includes(country) : true;
    })
    .map((g) => g.groupId);

  /* 2️⃣ NEW – ticket-support groups (same filter) */
  let ticketGroupIds: string[] = [];
  if (type === "ticket_created" || type === "ticket_replied") {
    const supRows = await db
      .selectFrom("ticketSupportGroups")
      .select(["groupId", "countries"])
      .where("organizationId", "=", organizationId)
      .execute();

    ticketGroupIds = supRows
      .filter((g) => {
        const arr: string[] = Array.isArray(g.countries)
          ? (g.countries as unknown as string[])
          : JSON.parse(g.countries || "[]");
        return country ? arr.includes(country) : true;
      })
      .map((g) => g.groupId);
  }

  const targets: { chatId: string; text: string; markup?: string }[] = [];
  const seenChatIds = new Set<string>(); // de-dupe across everything
  const ticketSet = new Set(ticketGroupIds); // for selective Reply button
  const uniqueGroupIds = Array.from(new Set([...orderGroupIds, ...ticketGroupIds]));

  if (bodyAdmin.trim()) {
    const safeAdmin = toTelegramHtml(bodyAdmin);
    // admins (user IDs)
    for (const id of adminUserIds) {
      if (id && !seenChatIds.has(id)) {
        seenChatIds.add(id);
        targets.push({ chatId: id, text: safeAdmin });
      }
    }
    // groups (orders + tickets) – de-duplicated
    for (const id of uniqueGroupIds) {
      if (!id || seenChatIds.has(id)) continue;
      seenChatIds.add(id);
      const markup =
        ticketId && ticketSet.has(id)
          ? JSON.stringify({
              inline_keyboard: [
                [{ text: "💬 Reply", callback_data: `support:reply:${ticketId}` }],
              ],
            })
          : undefined;
      targets.push({ chatId: id, text: safeAdmin, ...(markup ? { markup } : {}) });
    }
  }

  if (clientUserId && bodyUser.trim()) {
    // client DM – also respect de-dupe (paranoia)
    if (!seenChatIds.has(clientUserId)) {
      seenChatIds.add(clientUserId);
      targets.push({ chatId: clientUserId, text: toTelegramHtml(bodyUser) });
    }
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
          ...(t.markup ? { reply_markup: t.markup } : {}),
        }),
      }).catch(() => null),
    ),
  );
}