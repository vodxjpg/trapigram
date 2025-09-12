// src/lib/rules.ts
import { pgPool as pool } from "@/lib/db";
import { sendNotification, type NotificationChannel } from "@/lib/notifications";

type EventType =
  | "order_placed"
  | "order_pending_payment"
  | "order_paid"
  | "order_completed"
  | "order_cancelled"
  | "order_refunded"
  | "order_partially_paid"
  | "order_shipped"
  | "order_message"
  | "ticket_created"
  | "ticket_replied"
  | "manual"
  | "customer_inactive";

type RuleRow = {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: EventType;
  countries: string; // JSON string
  action: "send_coupon" | "product_recommendation";
  channels: string; // JSON string
  payload: any; // JSON or object
};

type ConditionsGroup = {
  op: "AND" | "OR";
  items: Array<
    | { kind: "contains_product"; productIds: string[] }
    | { kind: "order_total_gte_eur"; amount: number }
    | { kind: "no_order_days_gte"; days: number }
  >;
};

/* -------------------------------- helpers -------------------------------- */

async function getOrderProductIds(orderId: string): Promise<string[]> {
  if (!orderId) return [];
  const { rows: o } = await pool.query(
    `SELECT "cartId" FROM orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  const cartId = o[0]?.cartId;
  if (!cartId) return [];
  const { rows } = await pool.query(
    `SELECT "productId","affiliateProductId"
       FROM "cartProducts"
      WHERE "cartId" = $1`,
    [cartId],
  );
  const ids = new Set<string>();
  for (const r of rows) {
    if (r.productId) ids.add(String(r.productId));
    if (r.affiliateProductId) ids.add(String(r.affiliateProductId));
  }
  return [...ids];
}

async function getOrderEURTotal(orderId: string): Promise<number | null> {
  if (!orderId) return null;
  const { rows } = await pool.query(
    `SELECT "EURtotal" FROM "orderRevenue" WHERE "orderId" = $1 LIMIT 1`,
    [orderId],
  );
  if (!rows.length) return null;
  const v = Number(rows[0].EURtotal ?? 0);
  return Number.isFinite(v) ? v : 0;
}

/**
 * Returns number of days since the latest "paid" or "completed" order.
 * If the client has never ordered, returns +Infinity.
 */
async function getDaysSinceLastPaidOrCompletedOrder(
  organizationId: string,
  clientId: string | null,
): Promise<number | null> {
  if (!clientId) return null;
  const { rows } = await pool.query(
    `
    SELECT GREATEST(
             COALESCE(MAX("datePaid"), to_timestamp(0)),
             COALESCE(MAX("dateCompleted"), to_timestamp(0)),
             COALESCE(MAX("dateCreated"), to_timestamp(0))
           ) AS last_ts
      FROM orders
     WHERE "organizationId" = $1
       AND "clientId" = $2
       AND status IN ('paid','completed')
    `,
    [organizationId, clientId],
  );
  const lastTs: Date | null = rows[0]?.last_ts ?? null;
  if (!lastTs) return Number.POSITIVE_INFINITY;
  const last = new Date(lastTs);
  const now = new Date();
  const ms = now.getTime() - last.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function evalConditions(
  grp: ConditionsGroup | undefined,
  ctx: {
    hasProduct: (ids: string[]) => boolean;
    eurTotal: number | null;
    daysSinceLastOrder: number | null;
  },
): boolean {
  if (!grp || !Array.isArray(grp.items) || !grp.items.length) return true; // no conditions = pass
  const evalOne = (c: ConditionsGroup["items"][number]) => {
    if (c.kind === "contains_product") return ctx.hasProduct(c.productIds || []);
    if (c.kind === "order_total_gte_eur") {
      if (ctx.eurTotal == null) return false;
      return ctx.eurTotal >= (Number(c.amount) || 0);
    }
    if (c.kind === "no_order_days_gte") {
      if (ctx.daysSinceLastOrder == null) return false;
      const d =
        ctx.daysSinceLastOrder === Number.POSITIVE_INFINITY
          ? Infinity
          : ctx.daysSinceLastOrder;
      return d >= (Number(c.days) || 0);
    }
    return false;
  };
  return grp.op === "OR" ? grp.items.some(evalOne) : grp.items.every(evalOne);
}

/* ----------------------- placeholders + formatting ----------------------- */

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replacePlaceholders(html: string, map: Record<string, string>): string {
  let out = html || "";
  for (const [k, v] of Object.entries(map)) {
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v ?? "");
  }
  return out;
}

async function getCouponCode(organizationId: string, couponId: string | null | undefined) {
  if (!couponId) return null;
  const { rows } = await pool.query(
    `SELECT code FROM coupons WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [couponId, organizationId],
  );
  return rows[0]?.code ?? null;
}

async function getProductTitles(organizationId: string, ids: string[]) {
  if (!ids?.length) return [] as string[];
  const { rows } = await pool.query(
    `SELECT id, title FROM products WHERE "organizationId" = $1 AND id = ANY($2::uuid[])`,
    [organizationId, ids],
  );
  return rows.map((r) => String(r.title || ""));
}

/* ----------------------------- main processor ---------------------------- */

export async function processAutomationRules(opts: {
  organizationId: string;
  event: EventType;
  country?: string | null;
  variables?: Record<string, string>;
  clientId?: string | null;
  userId?: string | null;
  orderId?: string | null;
  url?: string | null;
}) {
  const {
    organizationId,
    event,
    country = null,
    variables = {},
    clientId = null,
    userId = null,
    url = null,
    orderId = null,
  } = opts;

  // Pull enabled rules for this event, ordered by priority.
  const res = await pool.query(
    `
    SELECT id,"organizationId",name,enabled,priority,event,
           countries,action,channels,payload
      FROM "automationRules"
     WHERE "organizationId" = $1
       AND event = $2
       AND enabled = TRUE
     ORDER BY priority ASC, "createdAt" DESC
    `,
    [organizationId, event],
  );

  // Context values available for conditions.
  const productIdsInOrder = orderId ? await getOrderProductIds(orderId) : [];
  const eurTotal = orderId ? await getOrderEURTotal(orderId) : null;
  const daysSinceLastOrder = await getDaysSinceLastPaidOrCompletedOrder(
    organizationId,
    clientId ?? null,
  );

  for (const raw of res.rows as RuleRow[]) {
    const countries: string[] = JSON.parse(raw.countries || "[]");
    if (countries.length && (!country || !countries.includes(country))) {
      continue; // country filter not matched
    }

    const channels: NotificationChannel[] = JSON.parse(raw.channels || "[]");
    const payload =
      typeof raw.payload === "string"
        ? JSON.parse(raw.payload || "{}")
        : raw.payload ?? {};
    const conditions: ConditionsGroup | undefined = payload?.conditions;

    const match = evalConditions(conditions, {
      hasProduct: (ids) => ids.some((id) => productIdsInOrder.includes(id)),
      eurTotal,
      daysSinceLastOrder,
    });
    if (!match) continue;

    // Build message & variables per action.
    let subject: string | undefined = payload.templateSubject || undefined;
    let message: string = payload.templateMessage || "";
    const vars: Record<string, string> = { ...variables };

    // Placeholder values
    const replacements: Record<string, string> = {};

    if (raw.action === "send_coupon") {
      if (payload.couponId && !vars.coupon_id) {
        vars.coupon_id = String(payload.couponId);
      }
      const code = await getCouponCode(organizationId, payload.couponId);
      if (code) {
        replacements.coupon = escapeHtml(code);
      } else {
        replacements.coupon = "";
      }
      if (!message) {
        message = `<p>You’ve received a coupon: {coupon}</p>`;
      }
    } else if (raw.action === "product_recommendation") {
      const ids: string[] = Array.isArray(payload.productIds)
        ? payload.productIds
        : [];
      if (ids.length && !vars.product_ids) {
        vars.product_ids = ids.join(",");
      }
      const titles = await getProductTitles(organizationId, ids);
      if (titles.length) {
        replacements.recommended_products =
          `<ul>${titles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`;
      } else {
        replacements.recommended_products = "";
      }
      if (!message) {
        message = `<p>We think you'll love these:</p>{recommended_products}`;
      }
    }

    // expand placeholders
    message = replacePlaceholders(message, replacements);
    if (!message.trim()) message = "<p>Notification</p>";

    await sendNotification({
      organizationId,
      type: raw.action === "send_coupon" ? "coupon_sent" : "product_recommendation",
      message,
      subject,
      channels, // "email" | "telegram"
      variables: vars,
      country,
      clientId,
      userId,
      url,
      trigger: null,
    });
  }
}
