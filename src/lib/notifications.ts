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
  | "order_pending_payment"
  | "order_paid"
  | "order_completed"
  | "order_cancelled"
  | "order_refunded"
  | "order_partially_paid"
  | "order_shipped"
  | "ticket_created"
  | "ticket_replied"
  | "order_message"
  | "automation_rule";

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
    (acc, [k, v]) => acc.replace(new RegExp(`{${k}}`, "g"), v ?? ""),
    txt,
  );

/** stripTags – quick server-side HTML removal */
const stripTags = (html: string) => html.replace(/<[^>]+>/g, "");

// Convert rich HTML to Telegram-safe HTML/text
const toTelegramHtml = (html: string) => {
  let out = html || "";
  // lists → bullets
  out = out
    .replace(/<\s*ul[^>]*>/gi, "")
    .replace(/<\s*\/\s*ul\s*>/gi, "")
    .replace(/<\s*li[^>]*>\s*/gi, "• ")
    .replace(/<\s*\/\s*li\s*>/gi, "\n");
  // paragraphs/line breaks
  out = out
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\/\s*p\s*>/gi, "\n")
    .replace(/<\s*br\s*\/?>/gi, "\n");
  // basic formatting
  out = out
    .replace(/<\s*strong\s*>/gi, "<b>")
    .replace(/<\s*\/\s*strong\s*>/gi, "</b>")
    .replace(/<\s*em\s*>/gi, "<i>")
    .replace(/<\s*\/\s*em\s*>/gi, "</i>");
  // links → "text (url)"
  out = out.replace(/<\s*a[^>]*href="([^"]+)"[^>]*>(.*?)<\/\s*a\s*>/gi, "$2 ($1)");
  // drop any remaining tags EXCEPT b/i/code
  out = out.replace(/<(?!\/?(?:b|i|code)\b)[^>]+>/g, "");
  // tidy up multiple blank lines
  out = out.replace(/\n{3,}/g, "\n\n").trim();
  return out;
};

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

  const isAutomation = type === "automation_rule";

  /* ───────────────── trigger normalization ───────────────── */
  const rawTrigger = trigger ?? null;
  const effectiveTrigger = isAutomation
    ? "user_only"
    : type === "order_message" && (rawTrigger === null || rawTrigger === "order_note")
      ? "admin_only"
      : rawTrigger;

  // ───────────────── DEBUG overview (no secrets) ─────────────────
  console.log("[notify] dispatch start", {
    organizationId,
    type,
    trigger: effectiveTrigger,
    channels,
    country,
    hasSubject: Boolean(subject),
    hasMessageHtml: Boolean(message && message.length),
    userId,
    clientId,
    urlPresent: Boolean(url),
    ticketId,
  });

  /* enrich variables (tracking link) */
  if (variables.tracking_number) {
    const tn = variables.tracking_number;
    variables.tracking_number = `${tn}<br>https://www.ordertracker.com/track/${tn}`;
  }

  /* 1️⃣ templates */
  let tplUser:
    | { role: "admin" | "user"; subject: string | null; message: string; countries: string }
    | undefined;
  let tplAdmin:
    | { role: "admin" | "user"; subject: string | null; message: string; countries: string }
    | undefined;
  let hasUserTpl = false;
  let hasAdminTpl = false;

  if (!isAutomation) {
    const templates = await db
      .selectFrom("notificationTemplates")
      .select(["role", "subject", "message", "countries"])
      .where("organizationId", "=", organizationId)
      .where("type", "=", type)
      .execute();
    tplUser = pickTemplate("user", country, templates);
    tplAdmin = pickTemplate("admin", country, templates);
    hasUserTpl = !!tplUser;
    hasAdminTpl = !!tplAdmin;
  }
  const suppressAdminFanout = effectiveTrigger === "user_only_email" || isAutomation;
  const suppressUserFanout = effectiveTrigger === "admin_only";

  const isAdminOnlyOrderNote =
    effectiveTrigger === "admin_only" && type === "order_message";

  const isUserOnlyOrderNote =
    type === "order_message" &&
    (effectiveTrigger === "user_only" || effectiveTrigger === "user_only_email");

  const shouldAdminFanout =
    !suppressAdminFanout && (hasAdminTpl || isAdminOnlyOrderNote);
  const shouldUserFanout =
    !suppressUserFanout && (hasUserTpl || isUserOnlyOrderNote);

  let finalAdminFanout = shouldAdminFanout;
  let finalUserFanout = shouldUserFanout;
  if (isAutomation) {
    finalAdminFanout = false;
    finalUserFanout = true;
  }

  console.log("[notify] templates & fanout", {
    hasUserTpl,
    hasAdminTpl,
    suppressAdminFanout,
    suppressUserFanout,
    shouldAdminFanout: finalAdminFanout,
    shouldUserFanout: finalUserFanout,
  });

  if (!finalAdminFanout && !finalUserFanout && !isAdminOnlyOrderNote) {
    console.log("[notify] skip: no matching templates for admin or user; nothing to send.");
    return;
  }

  /* 2️⃣ subjects & bodies – generic (all channels) */
  const makeRawSub = (
    tplSubject: string | null | undefined,
    fallback: string | undefined,
  ) =>
    !tplSubject && !fallback
      ? type.replace(/_/g, " ")
      : (tplSubject || fallback || "").trim();

  let subjectUserGeneric = "";
  let subjectAdminGeneric = "";
  let bodyUserGeneric = "";
  let bodyAdminGeneric = "";

  if (isAutomation) {
    subjectUserGeneric = applyVars(makeRawSub(null, subject), variables);
    bodyUserGeneric = applyVars(message, variables);
  } else {
    const rawSubUser = makeRawSub(tplUser?.subject, subject);
    const rawSubAdm = makeRawSub(tplAdmin?.subject, subject);
    subjectUserGeneric = applyVars(rawSubUser, variables);
    subjectAdminGeneric = applyVars(rawSubAdm, variables);
    bodyUserGeneric = applyVars(tplUser?.message || message, variables);
    bodyAdminGeneric = applyVars(tplAdmin?.message || message, variables);
  }

  if (!isAutomation && isAdminOnlyOrderNote) {
    bodyAdminGeneric = applyVars(message, variables);
  }

  /* 2️⃣-bis subjects & bodies – e-mail only (product list hidden) */
  const varsEmail = {
    ...variables,
    product_list:
      "Due to privacy reasons you can only see the product list in your order details page or message notification by the API",
  };

  const subjectUserEmail = isAutomation
    ? subjectUserGeneric
    : applyVars(makeRawSub(tplUser?.subject, subject), varsEmail);
  const subjectAdminEmail = isAutomation
    ? subjectAdminGeneric
    : applyVars(makeRawSub(tplAdmin?.subject, subject), varsEmail);
  const bodyUserEmail = isAutomation
    ? bodyUserGeneric
    : applyVars(tplUser?.message || message, varsEmail);
  const bodyAdminEmail = isAutomation
    ? bodyAdminGeneric
    : applyVars(tplAdmin?.message || message, varsEmail);

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
  console.log("[notify] support email", { present: Boolean(supportEmail) });

  /* 4️⃣ e-mail targets */
  const adminEmails: string[] = [];
  const userEmails: string[] = [];

  if (userId) {
    const u = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (u?.email) userEmails.push(u.email);
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

  console.log("[notify] resolved email targets", {
    adminCount: adminEmails.length,
    userCount: userEmails.length,
    adminPreview: adminEmails.slice(0, 3),
    userPreview: userEmails.slice(0, 3),
  });

  /* 5️⃣ master log */
  await db
    .insertInto("notifications")
    .values({
      id: uuidv4(),
      organizationId,
      type,
      trigger: effectiveTrigger,
      message: bodyUserGeneric,
      channels: JSON.stringify(channels),
      country,
      targetUserId: userId,
      targetClientId: clientId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  console.log("[notify] master log inserted");

  /* 6️⃣ channel fan-out */
  /* — EMAIL — */
  if (channels.includes("email")) {
    console.log("[notify] EMAIL fanout", {
      shouldAdminFanout: finalAdminFanout,
      shouldUserFanout: finalUserFanout,
      adminCount: adminEmails.length,
      userCount: userEmails.length,
    });

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

    if (!isAutomation && adminEmails.length && finalAdminFanout) {
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

    if (userEmails.length && finalUserFanout) {
      promises.push(
        ...userEmails.map((addr) =>
          send({
            to: addr,
            subject: subjectUserEmail,
            html: bodyUserEmail,
            text: bodyUserEmail.replace(/<[^>]+>/g, ""),
            cc: isAutomation ? null : supportEmail,
          }),
        ),
      );
    }

    await Promise.all(promises);
    console.log("[notify] EMAIL done");
  }

  /* — IN-APP — */
  if (channels.includes("in_app")) {
    console.log("[notify] IN_APP fanout begin");
    const targets = new Set<string | null>();
    if (shouldUserFanout) {
      if (userId) targets.add(userId);
      if (clientRow?.userId) targets.add(clientRow.userId);
    }
    if (finalAdminFanout) {
      ownerIds.forEach((id) => targets.add(id));
    }
    for (const uid of targets) {
      await dispatchInApp({
        organizationId,
        userId: uid,
        clientId,
        message: bodyUserGeneric,
        country,
        url,
      });
    }
    console.log("[notify] IN_APP done", {
      targetCount: Array.from(targets).filter(Boolean).length,
    });
  }

  /* — WEBHOOK — */
  if (channels.includes("webhook")) {
    if (!isAutomation && finalAdminFanout) {
      console.log("[notify] WEBHOOK dispatch");
      await dispatchWebhook({ organizationId, type, message: bodyUserGeneric });
      console.log("[notify] WEBHOOK done");
    }
  }

  /* — TELEGRAM — */
  if (channels.includes("telegram")) {
    const wantAdminGroups =
      !isAutomation && effectiveTrigger === "admin_only" && finalAdminFanout;
    const wantClientDM = finalUserFanout;

    const bodyAdminOut = wantAdminGroups ? bodyAdminGeneric : "";
    const bodyUserOut = wantClientDM ? bodyUserGeneric : "";
    console.log("[notify] TELEGRAM fanout", {
      wantAdminGroups,
      wantClientDM,
      hasAdminTpl,
      bodyAdminLen: bodyAdminOut.length,
      bodyUserLen: bodyUserOut.length,
    });

    await dispatchTelegram({
      organizationId,
      type,
      country,
      bodyAdmin: bodyAdminOut,
      bodyUser: bodyUserOut,
      adminUserIds: [],
      clientUserId: wantClientDM ? clientRow?.userId || null : null,
      ticketId,
    });
    console.log("[notify] TELEGRAM done");
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

/** Resolve the effective country for Telegram fan-out.
 *  If `country` is null/empty, try ticket → client country; else return uppercased input.
 */
async function resolveCountryForTelegram(opts: {
  organizationId: string;
  ticketId?: string | null;
  country?: string | null;
}): Promise<string | null> {
  const c = (opts.country || "").trim();
  if (c) return c.toUpperCase();

  const ticketId = opts.ticketId?.trim();
  if (!ticketId) return null;

  // Join ticket → client to fetch the client's country, scoped to this org.
  const row = await db
    .selectFrom("tickets as t")
    .innerJoin("clients as c", "c.id", "t.clientId")
    .select(["c.country as country"])
    .where("t.id", "=", ticketId)
    .where("t.organizationId", "=", opts.organizationId)
    .executeTakeFirst();

  const cc = (row?.country || "").trim();
  return cc ? cc.toUpperCase() : null;
}

/** Country-aware match: if a country is known ⇒ allow exact or "*" wildcard.
 *  If unknown ⇒ only groups explicitly registered for "*" will receive it.
 */
function groupMatchesCountry(rawCountries: unknown, country: string | null): boolean {
  let arr: string[] = [];
  try {
    if (Array.isArray(rawCountries)) arr = rawCountries as string[];
    else arr = JSON.parse((rawCountries as string) || "[]");
  } catch {
    arr = [];
  }
  const up = arr.map((x) => (typeof x === "string" ? x.toUpperCase().trim() : "")).filter(Boolean);
  if (!country) return up.includes("*"); // do NOT broadcast to all when country is unknown
  return up.includes(country) || up.includes("*");
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

  // 🔎 NEW: resolve effective country if missing, using ticket → client
  const effectiveCountry = await resolveCountryForTelegram({
    organizationId,
    ticketId: ticketId ?? null,
    country: country ?? null,
  });

  const groupRows = await db
    .selectFrom("notificationGroups")
    .select(["groupId", "countries"])
    .where("organizationId", "=", organizationId)
    .execute();

  const orderGroupIds = groupRows
    .filter((g) => groupMatchesCountry(g.countries, effectiveCountry))
    .map((g) => g.groupId);

  /* 2️⃣ ticket-support groups */
  let ticketGroupIds: string[] = [];
  if (type === "ticket_created" || type === "ticket_replied") {
    const supRows = await db
      .selectFrom("ticketSupportGroups")
      .select(["groupId", "countries"])
      .where("organizationId", "=", organizationId)
      .execute();

    ticketGroupIds = supRows
      .filter((g) => groupMatchesCountry(g.countries, effectiveCountry))
      .map((g) => g.groupId);
  }

  const targets: { chatId: string; text: string; markup?: string }[] = [];
  const seenChatIds = new Set<string>();
  const ticketSet = new Set(ticketGroupIds);
  const uniqueGroupIds = Array.from(new Set([...orderGroupIds, ...ticketGroupIds]));
  console.log("[telegram] targets discovery", {
    hasBodyAdmin: Boolean(bodyAdmin && bodyAdmin.trim().length),
    hasBodyUser: Boolean(bodyUser && bodyUser.trim().length),
    orderGroupCount: orderGroupIds.length,
    ticketGroupCount: ticketGroupIds.length,
    uniqueGroupCount: uniqueGroupIds.length,
    hasClientDM: Boolean(clientUserId),
    effectiveCountry,
  });

  if (bodyAdmin.trim()) {
    const safeAdmin = toTelegramHtml(bodyAdmin);
    for (const id of adminUserIds) {
      if (id && !seenChatIds.has(id)) {
        seenChatIds.add(id);
        targets.push({ chatId: id, text: safeAdmin });
      }
    }
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
    if (!seenChatIds.has(clientUserId)) {
      seenChatIds.add(clientUserId);
      targets.push({ chatId: clientUserId, text: toTelegramHtml(bodyUser) });
    }
  }

  const mask = (s: string) => (s.length > 6 ? `${s.slice(0, 2)}…${s.slice(-4)}` : s);
  console.log("[telegram] final targets", {
    count: targets.length,
    chatIds: targets.map((t) => mask(t.chatId)),
    kinds: targets.map((t) =>
      ticketId && t.markup ? "group+ticket" : orderGroupIds.includes(t.chatId) ? "group" : "dm",
    ),
  });

  await Promise.all(
    targets.map(async (t) => {
      const res = await fetch(BOT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: t.chatId,
          text: t.text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
          ...(t.markup ? { reply_markup: t.markup } : {}),
        }),
      }).catch((e) => {
        console.warn("[telegram] network error", e);
        return null;
      });
      if (res && !res.ok) {
        const err = await res.text().catch(() => "");
        console.error("[telegram] API error", res.status, res.statusText, err.slice(0, 300));
      }
    }),
  );
  console.log("[telegram] sent", { count: targets.length });
}
