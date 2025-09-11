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
  | "manual";

type RuleRow = {
  id: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  priority: number;
  event: EventType;
  countries: string;          // JSON string
  orderCurrencyIn: string;    // JSON string
  action: "send_coupon" | "product_recommendation";
  channels: string;           // JSON string
  payload: any;               // JSON or object
};

async function getOrderProductIds(orderId: string): Promise<string[]> {
  // Collect product ids (native) and affiliateProductId as well, since a store might care about either.
  // You can narrow to only productId if that’s your intent.
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
  const ids: string[] = [];
  for (const r of rows) {
    if (r.productId) ids.push(String(r.productId));
    if (r.affiliateProductId) ids.push(String(r.affiliateProductId));
  }
  return Array.from(new Set(ids));
}

export async function processAutomationRules(opts: {
  organizationId: string;
  event: EventType;
  country?: string | null;
  orderCurrency?: string | null;
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
    orderCurrency = null,
    variables = {},
    clientId = null,
    userId = null,
    url = null,
    orderId = null,
  } = opts;

  const res = await pool.query(
    `
    SELECT id, "organizationId", name, enabled, priority, event,
           countries, "orderCurrencyIn", action, channels, payload
      FROM "automationRules"
     WHERE "organizationId" = $1
       AND event = $2
       AND enabled = TRUE
     ORDER BY priority ASC, "createdAt" DESC
    `,
    [organizationId, event],
  );

  const orderProductIds = orderId ? await getOrderProductIds(orderId) : [];

  for (const raw of res.rows as RuleRow[]) {
    const countries: string[] = JSON.parse(raw.countries || "[]");
    const orderCurrencyIn: string[] = JSON.parse(raw.orderCurrencyIn || "[]");
    const channels: NotificationChannel[] = JSON.parse(raw.channels || "[]");
    const payload =
      typeof raw.payload === "string" ? JSON.parse(raw.payload) : (raw.payload || {});

    // country filter
    if (countries.length && (!country || !countries.includes(country))) continue;
    // currency filter
    if (orderCurrencyIn.length && (!orderCurrency || !orderCurrencyIn.includes(orderCurrency))) continue;

    // product filter (optional): payload.onlyIfProductIdsAny: string[]
    const onlyIfAny: string[] = Array.isArray(payload.onlyIfProductIdsAny)
      ? payload.onlyIfProductIdsAny.map(String)
      : [];
    if (onlyIfAny.length && orderProductIds.length) {
      const hasAny = onlyIfAny.some((id) => orderProductIds.includes(id));
      if (!hasAny) continue; // does not match product condition
    } else if (onlyIfAny.length && !orderId) {
      // We cannot evaluate, play safe and skip (or flip to allow if you prefer)
      continue;
    }

    // build message/subject per action
    let subject = payload.templateSubject || undefined;
    let message = payload.templateMessage || "";
    const vars: Record<string, string> = { ...variables };

    if (raw.action === "send_coupon") {
      if (payload.code && !vars.coupon) vars.coupon = String(payload.code);
      if (!message) message = `<p>Use code <b>{coupon}</b> on your next order.</p>`;
    }
    if (raw.action === "product_recommendation") {
      if (payload.productIds?.length && !vars.product_ids) {
        vars.product_ids = payload.productIds.join(",");
      }
      if (!message) message = `<p>We think you'll love these: {product_ids}</p>`;
    }
    if (!message.trim()) message = "<p>Notification</p>";

    // We keep NotificationType compatible → use "order_message"
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
