// src/lib/rules.ts
import { pgPool as pool } from "@/lib/db";
import { sendNotification, type NotificationChannel } from "@/lib/notifications";
import { v4 as uuidv4 } from "uuid";

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
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: string; // JSON string
  payload: any; // JSON or object
};

type ConditionsGroup = {
  op: "AND" | "OR";
  items: Array<
    | { kind: "contains_product"; productIds: string[] }
    | { kind: "order_total_gte"; amount: number }
    | { kind: "no_order_days_gte"; days: number }
  >;
};

type RunScope = "per_order" | "per_customer";

const EURO_COUNTRIES = new Set([
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES"
]);

function currencyFromCountry(c: string) {
  return c === "GB" ? "GBP" : EURO_COUNTRIES.has(c) ? "EUR" : "USD";
}

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

// Robust normalized total in EUR (internal); used for order_total_gte comparisons.
async function getOrderEURTotalRobust(orderId: string): Promise<number | null> {
  // 1) try revenue first
  const fromRevenue = await getOrderEURTotal(orderId);
  if (fromRevenue != null) return fromRevenue;

  // 2) fallback: compute from orders.totalAmount with FX
  const { rows: orows } = await pool.query(
    `SELECT totalAmount::numeric AS total, country
       FROM orders
      WHERE id = $1
      LIMIT 1`,
    [orderId],
  );
  if (!orows.length) return null;

  const total = Number(orows[0].total ?? 0);
  const country = String(orows[0].country ?? "");
  if (!Number.isFinite(total)) return null;

  // latest FX (row stores USD→EUR and USD→GBP factors)
  const { rows: fxRows } = await pool.query(
    `SELECT "EUR","GBP" FROM "exchangeRate" ORDER BY date DESC LIMIT 1`
  );
  const USDEUR = Number(fxRows?.[0]?.EUR ?? 1) || 1;
  const USDGBP = Number(fxRows?.[0]?.GBP ?? 1) || 1;

  const cur = currencyFromCountry(country);
  if (cur === "EUR") return total;
  if (cur === "GBP") return total * (USDEUR / USDGBP); // GBP→USD→EUR
  return total * USDEUR; // USD default
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

/** Round to nearest 0.1 (one decimal place) */
function round1(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

/** Persist (append) an automation event into orders.orderMeta and update a convenience max */
async function appendOrderAutomationEvent(opts: {
  organizationId: string;
  orderId: string;
  entry: any;
}) {
  const { organizationId, orderId, entry } = opts;
  const { rows } = await pool.query(
    `SELECT "orderMeta" FROM orders WHERE id = $1 AND "organizationId" = $2`,
    [orderId, organizationId],
  );

  const raw = rows[0]?.orderMeta;
  let meta: any;
  try {
    meta = typeof raw === "string" ? JSON.parse(raw) : (raw ?? {});
  } catch { meta = {}; }

  // Normalize container
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) meta = {};

  const automationRoot = (meta as any).automation;
  const automation =
    automationRoot && typeof automationRoot === "object" && !Array.isArray(automationRoot)
      ? automationRoot
      : {};

  const events = Array.isArray((automation as any).events) ? (automation as any).events : [];
  events.push(entry);
  (automation as any).events = events;

  if (entry?.event === "points_multiplier" && typeof entry.factor === "number") {
    const prevMax = Math.max(
      1,
      ...events
        .filter((e: any) => e?.event === "points_multiplier" && Number.isFinite(Number(e.factor)))
        .map((e: any) => Number(e.factor))
    );
    (automation as any).maxPointsMultiplier = prevMax;
  }

  (meta as any).automation = automation;
  await pool.query(
    `UPDATE orders SET "orderMeta" = $3, "updatedAt" = NOW() WHERE id = $1 AND "organizationId" = $2`,
    [orderId, organizationId, JSON.stringify(meta)],
  );
}

/* Affiliate points helpers (same semantics as /api/affiliate/points) */
async function applyBalanceDelta(
  clientId: string,
  organizationId: string,
  deltaCurrent: number,
) {
  await pool.query(
    `
    INSERT INTO "affiliatePointBalances"("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
    VALUES ($1,$2,$3,0,NOW(),NOW())
    ON CONFLICT("clientId","organizationId") DO UPDATE SET
      "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
      "updatedAt" = NOW()
    `,
    [clientId, organizationId, deltaCurrent],
  );
}

async function getClientName(
  organizationId: string,
  clientId: string | null
): Promise<string | null> {
  if (!clientId) return null;
  const { rows } = await pool.query(
    `SELECT "firstName","lastName"
       FROM "clients"
      WHERE "organizationId" = $1 AND id = $2
      LIMIT 1`,
    [organizationId, clientId],
  );
  const fn = rows[0]?.firstName ? String(rows[0].firstName) : "";
  const ln = rows[0]?.lastName ? String(rows[0].lastName) : "";
  const full = `${fn} ${ln}`.trim();
  return full || null;
}

function evalConditions(
  grp: ConditionsGroup | undefined,
  ctx: {
    hasProduct: (ids: string[]) => boolean;
    eurTotal: number | null;            // internal normalized total (EUR)
    daysSinceLastOrder: number | null;
  },
): boolean {
  if (!grp || !Array.isArray(grp.items) || !grp.items.length) return true; // no conditions = pass
  const evalOne = (c: ConditionsGroup["items"][number]) => {
    if (c.kind === "contains_product") return ctx.hasProduct(c.productIds || []);
    if (c.kind === "order_total_gte") {
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

/* -------------------------- scope & dedupe locking ------------------------- */

function resolveScope(event: EventType, payload: any): RunScope {
  // UI may send payload.scope; default logic here for safety:
  // - customer_inactive can only be per_customer
  // - order_* default per_order
  const uiScope = payload?.scope as RunScope | undefined;
  if (event === "customer_inactive") return "per_customer";
  return uiScope === "per_customer" ? "per_customer" : "per_order";
}

/**
 * Try to acquire a one-time lock so the rule fires only once per scope.
 * We key by a synthetic dedupeKey and rely on a UNIQUE index.
 *
 * - per_order:    rule:<ruleId>:order:<orderId>
 * - per_customer: rule:<ruleId>:client:<clientId>
 */
async function tryAcquireRuleLock(opts: {
  organizationId: string;
  ruleId: string;
  event: EventType;
  scope: RunScope;
  clientId: string | null;
  orderId: string | null;
}): Promise<boolean> {
  const { organizationId, ruleId, event, scope, clientId, orderId } = opts;

  if (scope === "per_order" && !orderId) return false;
  if (scope === "per_customer" && !clientId) return false;

  const dedupeKey =
    scope === "per_order"
      ? `rule:${ruleId}:order:${orderId}`
      : `rule:${ruleId}:client:${clientId}`;

  const { rowCount } = await pool.query(
    `
    INSERT INTO "automationRuleLocks"
      ("organizationId","ruleId","event","clientId","orderId","dedupeKey","createdAt")
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT ("organizationId","dedupeKey") DO NOTHING
  `,
    [organizationId, ruleId, event, clientId, orderId, dedupeKey],
  );

  return rowCount > 0;
}

/* ----------------------------- main processor ---------------------------- */

export async function processAutomationRules(opts: {
  organizationId: string;
  event: EventType;
  country?: string | null;
  variables?: Record<string, string>;
  orderCurrency?: string | null; // kept for callers; not used here directly
  clientId?: string | null;
  userId?: string | null;
  orderId?: string | null;
  url?: string | null;
  /** optional: run only a subset of rule IDs (e.g., sweep matched) */
  onlyRuleIds?: string[] | null;
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
    onlyRuleIds = null,
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
  const eurTotal = orderId ? await getOrderEURTotalRobust(orderId) : null; // internal normalized
  const daysSinceLastOrder = await getDaysSinceLastPaidOrCompletedOrder(
    organizationId,
    clientId ?? null,
  );

  // Optional customer name for placeholders
  const customerName = await getClientName(organizationId, clientId ?? null);

  // Prepare name-related placeholders once
  const baseReplacements: Record<string, string> = {};
  if (customerName) {
    const esc = escapeHtml(customerName);
    baseReplacements.customer_name = esc;
    baseReplacements.customer_name_with_comma = `, ${esc}`;
    baseReplacements.customer_name_prefix = `${esc}, `;
  } else {
    baseReplacements.customer_name = "";
    baseReplacements.customer_name_with_comma = "";
    baseReplacements.customer_name_prefix = "";
  }

  for (const raw of res.rows as RuleRow[]) {
    if (onlyRuleIds && onlyRuleIds.length && !onlyRuleIds.includes(raw.id)) {
      continue;
    }

    let countries: string[] = [];
    try {
      countries = Array.isArray((raw as any).countries)
        ? (raw as any).countries
        : JSON.parse(raw.countries || "[]");
    } catch { countries = []; }

    if (countries.length && (!country || !countries.includes(country))) continue;

    let channels: NotificationChannel[] = [];
    try {
      channels = Array.isArray((raw as any).channels)
        ? ((raw as any).channels as NotificationChannel[])
        : JSON.parse(raw.channels || "[]");
    } catch { channels = []; }

    const payload =
      typeof raw.payload === "string"
        ? (JSON.parse(raw.payload || "{}") as any)
        : (raw.payload ?? {});

    const conditions: ConditionsGroup | undefined = payload?.conditions;

    const match = evalConditions(conditions, {
      hasProduct: (ids) => ids.some((id) => productIdsInOrder.includes(id)),
      eurTotal,
      daysSinceLastOrder,
    });
    if (!match) continue;

    // Determine dedupe scope.
    const scope = resolveScope(raw.event, payload);

    // For customer_inactive, DO NOT acquire the permanent dedupe lock.
    // Repetition is governed by the sweep using ruleEngagement.lockUntil.
    if (raw.event !== "customer_inactive") {
      const acquired = await tryAcquireRuleLock({
        organizationId,
        ruleId: raw.id,
        event: raw.event,
        scope,
        clientId: clientId ?? null,
        orderId: orderId ?? null,
      });
      if (!acquired) continue; // already fired for this scope
    }

    // subject/message setup
    const ruleLabel = raw.name || "Automation rule";
    const nowIso = new Date().toISOString();

    let subject: string | undefined = payload.templateSubject || undefined;
    let message: string = payload.templateMessage || "";

    // Build placeholder map depending on rule mode
    const replacements: Record<string, string> = { ...baseReplacements };
    const vars: Record<string, string> = { ...(variables || {}) };
    if (customerName && !vars.customer_name) vars.customer_name = customerName;

    if (raw.action === "multi") {
      const acts: Array<{ type: string; payload?: any }> =
        Array.isArray(payload.actions) ? payload.actions : [];

      // send_coupon (within multi)
      const couponAct = acts.find((a) => a.type === "send_coupon");
      if (couponAct?.payload?.couponId) {
        const code = await getCouponCode(organizationId, couponAct.payload.couponId);
        if (code) replacements.coupon = `<code>${escapeHtml(code)}</code>`;
        if (!vars.coupon_id) vars.coupon_id = String(couponAct.payload.couponId);
      } else {
        replacements.coupon = replacements.coupon ?? "";
      }

      // product_recommendation (within multi)
      const prodAct = acts.find((a) => a.type === "product_recommendation");
      const ids: string[] = Array.isArray(prodAct?.payload?.productIds) ? prodAct.payload.productIds : [];
      if (ids.length) {
        const titles = await getProductTitles(organizationId, ids);
        const listHtml = titles.length ? `<ul>${titles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "";
        replacements.selected_products = listHtml;
        replacements.recommended_products = listHtml; // back-compat
        if (!vars.product_ids) vars.product_ids = ids.join(",");
      } else {
        replacements.selected_products = "";
        replacements.recommended_products = "";
      }

      // multiply_points → set per-order multiplier (order_* only)
      for (const a of acts.filter((x) => x.type === "multiply_points")) {
        if (!orderId) continue;
        const factorRaw = Number((a as any)?.payload?.factor ?? 0);
        if (Number.isFinite(factorRaw) && factorRaw > 0) {
          await appendOrderAutomationEvent({
            organizationId,
            orderId,
            entry: {
              event: "points_multiplier",
              factor: factorRaw,
              ruleId: raw.id,
              label: ruleLabel,
              description: (a as any)?.payload?.description ?? null,
              createdAt: nowIso,
            },
          });
        }
      }

      // award_points → immediate buyer credit (order_* and customer_inactive)
      for (const a of acts.filter((x) => x.type === "award_points")) {
        if (!clientId) continue; // needs a customer
        const ptsRaw = Number((a as any)?.payload?.points ?? 0);
        if (!Number.isFinite(ptsRaw) || ptsRaw <= 0) continue;
        const points = round1(ptsRaw);

        const logId = uuidv4();
        const description =
          (a as any)?.payload?.description ??
          `Rule bonus: ${ruleLabel}`;
        await pool.query(
          `
          INSERT INTO "affiliatePointLogs"(
            id,"organizationId","clientId",points,action,description,"sourceClientId",
            "createdAt","updatedAt"
          )
          VALUES($1,$2,$3,$4,$5,$6,$7,NOW(),NOW())
          `,
          [
            logId,
            organizationId,
            clientId,
            points,
            "rule_award_points",
            description,
            null,
          ],
        );
        await applyBalanceDelta(clientId, organizationId, points);
        vars.points_awarded = String(points);
      }

      // default message if none provided
      if (!message) {
        message = `<p>Here’s an update for you{customer_name_with_comma}.</p>{recommended_products}{coupon}`;
      }
    } else if (raw.action === "send_coupon") {
      const code = await getCouponCode(organizationId, payload.couponId);
      replacements.coupon = code ? `<code>${escapeHtml(code)}</code>` : "";
      if (payload.couponId && !vars.coupon_id) vars.coupon_id = String(payload.couponId);
      if (!message) {
        message = `<p>You’ve received a coupon{customer_name_with_comma}: {coupon}</p>`;
      }
    } else if (raw.action === "product_recommendation") {
      const ids: string[] = Array.isArray(payload.productIds) ? payload.productIds : [];
      if (ids.length && !vars.product_ids) vars.product_ids = ids.join(",");
      const titles = await getProductTitles(organizationId, ids);
      const listHtml = titles.length ? `<ul>${titles.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>` : "";
      replacements.selected_products = listHtml;
      replacements.recommended_products = listHtml;
      if (!message) {
        message = `<p>{customer_name_prefix}we think you'll love these:</p>{recommended_products}`;
      }
    }

    // apply placeholders (coupon, products, customer_name, etc.)
    message = replacePlaceholders(message, replacements).trim();
    if (!message) message = "<p>Notification</p>";

    // Allow placeholders in subject too
    subject = subject ? replacePlaceholders(subject, replacements) : undefined;

    // For order_paid/completed, ensure caller invokes after revenue is recorded
    // so order_total_gte evaluates against a real normalized total.

    await sendNotification({
      organizationId,
      type: "automation_rule",
      message,
      subject,
      channels,
      variables: vars,
      country,
      clientId,
      userId,
      url,
      trigger: "user_only",
    });
  }
}

/* ----------------------- placeholders + formatting ----------------------- */

function escapeHtml(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function replacePlaceholders(template: string, map: Record<string, string>): string {
  let out = template || "";
  for (const [k, v] of Object.entries(map)) {
    // Replace all occurrences of {key}
    out = out.replace(new RegExp(`\\{${k}\\}`, "g"), v ?? "");
  }
  // Remove any unreplaced simple placeholders to avoid leaking braces
  out = out.replace(/\{[a-zA-Z0-9_]+\}/g, "");
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
    `SELECT id, title FROM products WHERE "organizationId" = $1 AND id = ANY($2::text[])`,
    [organizationId, ids],
  );
  return rows.map((r) => String(r.title || ""));
}
