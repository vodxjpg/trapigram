import { pgPool as pool } from "@/lib/db";
import { sendNotification, type NotificationChannel } from "@/lib/notifications";

type EventType =
  | "order_placed" | "order_pending_payment" | "order_paid" | "order_completed"
  | "order_cancelled" | "order_refunded" | "order_partially_paid" | "order_shipped"
  | "order_message" | "ticket_created" | "ticket_replied" | "manual";

type RuleRow = {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: EventType;
  countries: string;          // JSON string
  action: "send_coupon" | "product_recommendation";
  channels: string;           // JSON string
  payload: any;               // JSON or object
};

type ConditionsGroup = {
  op: "AND" | "OR";
  items: Array<
    | { kind: "contains_product"; productIds: string[] }
    | { kind: "order_total_gte_eur"; amount: number }
  >;
};

async function getOrderProductIds(orderId: string): Promise<string[]> {
  const { rows: o } = await pool.query(
    `SELECT "cartId" FROM orders WHERE id = $1 LIMIT 1`,
    [orderId],
  );
  const cartId = o[0]?.cartId;
  if (!cartId) return [];
  const { rows } = await pool.query(
    `SELECT "productId","affiliateProductId" FROM "cartProducts" WHERE "cartId" = $1`,
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
  const { rows } = await pool.query(
    `SELECT "EURtotal" FROM "orderRevenue" WHERE "orderId" = $1 LIMIT 1`,
    [orderId],
  );
  if (!rows.length) return null;
  const v = Number(rows[0].EURtotal ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function evalConditions(
  grp: ConditionsGroup | undefined,
  ctx: { hasProduct: (ids: string[]) => boolean; eurTotal: number | null }
): boolean {
  if (!grp || !Array.isArray(grp.items) || !grp.items.length) return true; // no conditions = pass
  const evalOne = (c: ConditionsGroup["items"][number]) => {
    if (c.kind === "contains_product") return ctx.hasProduct(c.productIds || []);
    if (c.kind === "order_total_gte_eur") {
      if (ctx.eurTotal == null) return false; // can’t evaluate
      return ctx.eurTotal >= (Number(c.amount) || 0);
    }
    return false;
  };
  if (grp.op === "OR") return grp.items.some(evalOne);
  return grp.items.every(evalOne); // AND
}

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
    organizationId, event, country = null,
    variables = {}, clientId = null, userId = null, url = null, orderId = null,
  } = opts;

  const res = await pool.query(
    `
    SELECT id, "organizationId", name, enabled, priority, event,
           countries, action, channels, payload
      FROM "automationRules"
     WHERE "organizationId" = $1
       AND event = $2
       AND enabled = TRUE
     ORDER BY priority ASC, "createdAt" DESC
    `,
    [organizationId, event],
  );

  const productIds = orderId ? await getOrderProductIds(orderId) : [];
  const eurTotal = orderId ? await getOrderEURTotal(orderId) : null;

  for (const raw of res.rows as RuleRow[]) {
    const countries: string[] = JSON.parse(raw.countries || "[]");
    if (countries.length && (!country || !countries.includes(country))) continue;

    const channels: NotificationChannel[] = JSON.parse(raw.channels || "[]");
    const payload = typeof raw.payload === "string" ? JSON.parse(raw.payload || "{}") : (raw.payload ?? {});
    const conditions: ConditionsGroup | undefined = payload?.conditions;

    const match = evalConditions(conditions, {
      hasProduct: (ids) => ids.some((id) => productIds.includes(id)),
      eurTotal,
    });
    if (!match) continue;

    // Build message/subject per action
    let subject: string | undefined = payload.templateSubject || undefined;
    let message: string = payload.templateMessage || "";
    const vars: Record<string, string> = { ...variables };

    if (raw.action === "send_coupon") {
      if (payload.code && !vars.coupon) vars.coupon = String(payload.code);
      if (!message) message = `<p>Use code <b>{coupon}</b> on your next order.</p>`;
    } else if (raw.action === "product_recommendation") {
      if (payload.productIds?.length && !vars.product_ids) vars.product_ids = payload.productIds.join(",");
      if (!message) message = `<p>We think you'll love these: {product_ids}</p>`;
    }
    if (!message.trim()) message = "<p>Notification</p>";

    await sendNotification({
      organizationId,
      type: "order_message",
      message,
      subject,
      channels,
      variables: vars,
      country,
      clientId,
      userId,
      url,
      trigger: null,
    });
  }
}
