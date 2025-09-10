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
  countries: string;
  orderCurrencyIn: string;
  action: "send_coupon" | "product_recommendation";
  channels: string;
  payload: any;
};

export async function processAutomationRules(opts: {
  organizationId: string;
  event: EventType;
  country?: string | null;
  orderCurrency?: string | null;
  variables?: Record<string, string>;
  clientId?: string | null;
  userId?: string | null;
  orderId?: string | null; // if you need it for URLs/logs
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

  for (const raw of res.rows as RuleRow[]) {
    const countries: string[] = JSON.parse(raw.countries || "[]");
    const orderCurrencyIn: string[] = JSON.parse(raw.orderCurrencyIn || "[]");
    const channels: NotificationChannel[] = JSON.parse(raw.channels || "[]");
    const payload = typeof raw.payload === "string" ? JSON.parse(raw.payload) : raw.payload || {};

    // country filter
    if (countries.length && (!country || !countries.includes(country))) {
      continue;
    }
    // currency filter
    if (orderCurrencyIn.length && (!orderCurrency || !orderCurrencyIn.includes(orderCurrency))) {
      continue;
    }

    // build message/subject per action
    let subject = payload.templateSubject || undefined;
    let message = payload.templateMessage || "";

    const vars: Record<string, string> = { ...variables };

    if (raw.action === "send_coupon") {
      if (payload.code && !vars.coupon) vars.coupon = String(payload.code);
      if (!message) {
        message = `<p>Use code <b>{coupon}</b> on your next order.</p>`;
      }
    } else if (raw.action === "product_recommendation") {
      if (payload.productIds?.length && !vars.product_ids) {
        vars.product_ids = payload.productIds.join(",");
      }
      if (!message) {
        message = `<p>We think you'll love these: {product_ids}</p>`;
      }
    }

    // ensure some content
    if (!message.trim()) message = "<p>Notification</p>";

    await sendNotification({
      organizationId,
      type: raw.action === "send_coupon" ? "coupon_sent" : "product_recommendation",
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
