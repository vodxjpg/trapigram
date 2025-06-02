// src/lib/notifications.ts
"use server";

import { v4 as uuidv4 } from "uuid";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";

export type NotificationChannel = "email" | "in_app" | "webhook" | "telegram";
";

export interface SendNotificationParams {
  organizationId: string;
  type: "order_placed";                 // extend as you add more
  message: string;                      // fallback body
  subject?: string;                     // fallback subject
  variables?: Record<string, string>;   // { product_list: …, order_key: … }
  country?: string | null;
  trigger?: string | null;
  channels: NotificationChannel[];
  userId?: string | null;               // explicit admin/user (optional)
  clientId?: string | null;             // explicit client (optional)
}

/* ————————————————— helpers ————————————————— */
const applyVars = (txt: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`{${k}}`, "g"), v),
    txt,
  );

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
  // first try exact-country match → then country-agnostic
  const exact = templates.find((t) => {
    if (t.role !== role) return false;
    const arr: string[] = Array.isArray(t.countries)
      ? (t.countries as unknown as string[])
      : JSON.parse(t.countries || "[]");
    return country ? arr.includes(country) : arr.length === 0;
  });
  if (exact) return exact;

  return templates.find((t) => t.role === role && JSON.parse(t.countries || "[]").length === 0);
};

/* ————————————————— main dispatcher ————————————————— */
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

  /* ------------------------------------------------------------ */
  /* 1. Fetch ALL templates for this org/type (both roles)        */
  /* ------------------------------------------------------------ */
  const templates = await db
    .selectFrom("notificationTemplates")
    .select(["role", "subject", "message", "countries"])
    .where("organizationId", "=", organizationId)
    .where("type", "=", type)
    .execute();

  const tplUser  = pickTemplate("user",  country, templates);
  const tplAdmin = pickTemplate("admin", country, templates);

  /* ------------------------------------------------------------ */
  /* 2. Build subjects & bodies                                   */
  /* ------------------------------------------------------------ */
  const subjectUser  = (tplUser?.subject  || subject || type).trim().replace(/_/g, " ");
  const subjectAdmin = (tplAdmin?.subject || subject || type).trim().replace(/_/g, " ");

  const bodyUser  = applyVars(tplUser?.message  || message, variables);
  const bodyAdmin = applyVars(tplAdmin?.message || message, variables);

  /* ------------------------------------------------------------ */
  /* 3. Resolve e-mail recipients                                 */
  /* ------------------------------------------------------------ */
  const adminEmails: string[] = [];
  const userEmails: string[]  = [];

  /* explicit userId gets classified as admin                     */
  if (userId) {
    const u = await db
      .selectFrom("user")
      .select(["email"])
      .where("id", "=", userId)
      .executeTakeFirst();
    if (u?.email) adminEmails.push(u.email);
  }

  /* owners of the organization (member table)                    */
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

  /* client / end-user                                            */
  if (clientId) {
    const c = await db
      .selectFrom("clients")
      .select(["email"])
      .where("id", "=", clientId)
      .executeTakeFirst();
    if (c?.email) userEmails.push(c.email);
  }

  /* last-resort: org support address (acts like admin)           */
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

  /* ------------------------------------------------------------ */
  /* 4. Persist master log                                        */
  /* ------------------------------------------------------------ */
  await db
    .insertInto("notifications")
    .values({
      id: uuidv4(),
      organizationId,
      type,
      trigger,
      message: bodyUser,           // store *some* body – user one is fine
      channels: JSON.stringify(channels),
      country,
      targetUserId: userId,
      targetClientId: clientId,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  /* ------------------------------------------------------------ */
  /* 5. Fan-out by channel                                        */
  /* ------------------------------------------------------------ */
  if (channels.includes("email")) {
    await Promise.all([
      ...adminEmails.map((addr) => sendEmail({ to: addr, subject: subjectAdmin, text: bodyAdmin })),
      ...userEmails.map((addr) => sendEmail({ to: addr, subject: subjectUser,  text: bodyUser  })),
    ]);
  }

  if (channels.includes("in_app")) {
    await dispatchInApp({
      organizationId,
      userId,
      clientId,
      message: bodyUser,
      country,
    });
  }

  if (channels.includes("webhook")) {
    await dispatchWebhook({ organizationId, type, message: bodyUser });
  }

  if (channels.includes("telegram")) {
     await dispatchTelegram({
       organizationId,
       clientId,
       country,
       bodyUser,
       bodyAdmin,
     });
    }
}

/* ————————— in-app & webhook (unchanged) ————————— */
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
  clientId: string | null;
  country: string | null;
  bodyUser: string;
  bodyAdmin: string;
}) {
  const { organizationId, clientId, country, bodyUser, bodyAdmin } = opts;
  const BOT = process.env.TG_BOT_TOKEN!;
  if (!BOT) return;                    // skip if token not set

  /* ── 1) private DM to the client ── */
  if (clientId) {
    const c = await db
      .selectFrom("clients")
      .select(["userId"])
      .where("id", "=", clientId)
      .executeTakeFirst();
    if (c?.userId)
      await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: c.userId,
          text: bodyUser.replace(/<br>/g, "\n"),
          parse_mode: "HTML",
        }),
      });
  }

  /* ── 2) country-matching groups ── */
  const rows = await db
    .selectFrom("notificationGroups")
    .select(["groupId", "countries"])
    .where("organizationId", "=", organizationId)
    .execute();

  await Promise.all(
    rows
      .filter((r) => {
        const arr: string[] = Array.isArray(r.countries)
          ? (r.countries as unknown as string[])
          : JSON.parse(r.countries || "[]");
        return country ? arr.includes(country) : true;
      })
      .map((r) =>
        fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: r.groupId,
            text: bodyAdmin.replace(/<br>/g, "\n"),
            parse_mode: "HTML",
          }),
        }),
      ),
  );
}

