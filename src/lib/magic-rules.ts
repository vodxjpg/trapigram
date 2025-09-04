// src/lib/magic-rules.ts
/**
 * Magic Rules – core engine
 * ---------------------------------------------------------------
 * - Event locked to: order_paid
 * - Scope locked to: base
 * - Stop on match: ALWAYS TRUE (stop evaluating after first match)
 * - Run once per order: ALWAYS TRUE
 * - Hours are always inclusive
 * - Channels limited to: email | telegram
 * - Supports combined conditions (AND) and multiple actions per rule
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { pgPool as pool } from "@/lib/db";
import { enqueueNotificationFanout } from "@/lib/notification-outbox";
import type { NotificationChannel, NotificationType } from "@/lib/notifications";

/* ─────────────────────────────── Types ─────────────────────────────── */

export type MagicEventType = "order_paid" | "manual" | "sweep";

export interface EventPayloadBase {
  organizationId: string;
  clientId: string;                 // target client
  userId?: string | null;           // optional userId (account)
  country?: string | null;          // two-letter country, optional
}

export interface OrderPaidFacts {
  type: "order_paid";
  orderId: string;
  purchasedProductIds: string[];
  purchasedAtISO: string;           // ISO string
  baseAffiliatePointsAwarded?: number;
  /** computed for inactivity rule */
  daysSinceLastPurchase?: number;
}

export interface ManualFacts { type: "manual" }
export interface SweepFacts { type: "sweep"; daysSinceLastPurchase?: number }

export type EventFacts = OrderPaidFacts | ManualFacts | SweepFacts;
export type EventPayload = EventPayloadBase & EventFacts;

/* ─────────────────────────────── Rules ─────────────────────────────── */

export const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({
    kind: z.literal("customer_inactive_for_days"),
    days: z.number().int().min(1),
  }),
  z.object({
    kind: z.literal("purchased_product_in_list"),
    productIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    kind: z.literal("purchase_time_in_window"),
    fromHour: z.number().int().min(0).max(23),
    toHour: z.number().int().min(0).max(23),
    // inclusive is always ON; no toggle
  }),
]);

export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send_message_with_coupon"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1), // supports {coupon_code}, {client_id}, {order_id}
    channels: z.array(z.enum(["email", "telegram"] as const)).min(1),
    coupon: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      discountType: z.enum(["fixed", "percentage"]),
      discountAmount: z.number().positive(),
      usageLimit: z.number().int().min(0),
      expendingLimit: z.number().int().min(0),
      expendingMinimum: z.number().int().min(0).default(0),
      countries: z.array(z.string().min(2)).min(1),
      visibility: z.boolean(),
      stackable: z.boolean(),
      startDateISO: z.string().nullable().optional(),     // ISO or null
      expirationDateISO: z.string().nullable().optional() // ISO or null
    }),
  }),
  z.object({
    kind: z.literal("recommend_product"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1), // supports {product_id}, {client_id}, {order_id}
    channels: z.array(z.enum(["email", "telegram"] as const)).min(1),
    productId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("grant_affiliate_points"),
    points: z.number().int(), // can be negative to deduct
    action: z.string().min(1),
    description: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal("multiply_affiliate_points_for_order"),
    multiplier: z.number().positive(), // e.g. 2 = double; 1.5 = +50%
    action: z.string().default("promo_multiplier"),
    description: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal("queue_next_order_points"),
    points: z.number().int().positive(),
    expiresAtISO: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }),
]);

export type Action = z.infer<typeof ActionSchema>;

export const RuleSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  enabled: z.boolean().default(true),
  match: z.object({
    anyOfEvents: z.array(z.enum(["order_paid", "manual", "sweep"] as const)).min(1),
  }),
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
  stopAfterMatch: z.boolean().default(true), // enforced as TRUE
});

export type MagicRule = z.infer<typeof RuleSchema>;
export const RulesPayloadSchema = z.array(RuleSchema).min(1);

/* ───────────────────── helper: variables in templates ─────────────── */

function applyVars(txt: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (acc, [k, v]) => acc.replace(new RegExp(`{${k}}`, "g"), v ?? ""),
    txt,
  );
}

/* ───────────────────── Condition evaluators ───────────────────────── */

function checkCondition(cond: Condition, event: EventPayload): boolean {
  switch (cond.kind) {
    case "always":
      return true;

    case "customer_inactive_for_days": {
      const days =
        event.type === "sweep"
          ? (event as SweepFacts).daysSinceLastPurchase
          : event.type === "order_paid"
          ? (event as OrderPaidFacts).daysSinceLastPurchase
          : undefined;
      return typeof days === "number" && days >= cond.days;
    }

    case "purchased_product_in_list": {
      if (event.type !== "order_paid") return false;
      const ids = (event as OrderPaidFacts).purchasedProductIds;
      return ids.some((id) => cond.productIds.includes(id));
    }

    case "purchase_time_in_window": {
      if (event.type !== "order_paid") return false;
      const iso = (event as OrderPaidFacts).purchasedAtISO;
      const hour = new Date(iso).getHours();
      const from = cond.fromHour;
      const to = cond.toHour;
      const inclusive = true; // locked ON
      if (from === to) return inclusive; // whole-day if inclusive
      if (from < to) {
        return inclusive ? hour >= from && hour <= to : hour > from && hour < to;
      } else {
        return inclusive ? hour >= from || hour <= to : hour > from || hour < to;
      }
    }
  }
  return false;
}

/* ───────────────────── Actions – implementations ──────────────────── */

async function generateUniqueCouponCode(organizationId: string): Promise<string> {
  while (true) {
    const candidate = randomBytes(6).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(0, 8).toUpperCase();
    const { rows } = await pool.query(
      `SELECT 1 FROM coupons WHERE code = $1 AND "organizationId" = $2 LIMIT 1`,
      [candidate, organizationId],
    );
    if (rows.length === 0) return candidate;
  }
}

type CreatedCoupon = { id: string; code: string; expirationDate: string | null };

async function createCouponForOrg(
  organizationId: string,
  cfg: Action & { kind: "send_message_with_coupon" },
): Promise<CreatedCoupon> {
  const code = await generateUniqueCouponCode(organizationId);
  const insert = await pool.query(
    `
    INSERT INTO coupons(
      id, "organizationId", name, code, description,
      "discountType", "discountAmount",
      "startDate", "expirationDate",
      "limitPerUser", "usageLimit",
      "expendingLimit", "expendingMinimum",
      countries, visibility, stackable,
      "createdAt", "updatedAt"
    )
    VALUES(
      gen_random_uuid(), $1, $2, $3, $4,
      $5, $6,
      $7, $8,
      0, $9,
      $10, $11,
      $12, $13, $14,
      NOW(), NOW()
    )
    RETURNING id, code, "expirationDate"
    `,
    [
      organizationId,
      cfg.coupon.name,
      code,
      cfg.coupon.description,
      cfg.coupon.discountType,
      cfg.coupon.discountAmount,
      cfg.coupon.startDateISO ?? null,
      cfg.coupon.expirationDateISO ?? null,
      cfg.coupon.usageLimit,
      cfg.coupon.expendingLimit,
      cfg.coupon.expendingMinimum ?? 0,
      JSON.stringify(cfg.coupon.countries),
      cfg.coupon.visibility,
      cfg.coupon.stackable,
    ],
  );
  const row = insert.rows[0];
  return { id: row.id, code: row.code, expirationDate: row.expirationDate };
}

async function applyBalanceDelta(
  clientId: string,
  organizationId: string,
  deltaCurrent: number,
  deltaSpent: number,
  client: import("pg").PoolClient,
) {
  await client.query(
    `
    INSERT INTO "affiliatePointBalances"(
      "clientId","organizationId","pointsCurrent","pointsSpent",
      "createdAt","updatedAt"
    )
    VALUES($1,$2,$3,$4,NOW(),NOW())
    ON CONFLICT("clientId","organizationId") DO UPDATE SET
      "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
      "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + EXCLUDED."pointsSpent",
      "updatedAt"     = NOW()
    `,
    [clientId, organizationId, deltaCurrent, deltaSpent],
  );
}

async function grantAffiliatePointsOnce(opts: {
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description?: string | null;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      INSERT INTO "affiliatePointLogs"(
        id,"organizationId","clientId",points,action,description,"sourceClientId",
        "createdAt","updatedAt"
      )
      VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,NULL,NOW(),NOW())
      RETURNING *
      `,
      [opts.organizationId, opts.clientId, opts.points, opts.action, opts.description ?? null],
    );
    const inserted = rows[0];
    const deltaCurrent = inserted.points;
    const deltaSpent = inserted.points < 0 ? Math.abs(inserted.points) : 0;
    await applyBalanceDelta(opts.clientId, opts.organizationId, deltaCurrent, deltaSpent, client);
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

async function queueNextOrderPoints(opts: {
  organizationId: string;
  clientId: string;
  points: number;
  description?: string | null;
  expiresAtISO?: string | null;
}) {
  await pool.query(
    `
    INSERT INTO "affiliatePointBoosters"(
      "organizationId","clientId",points,"expiresAt","createdAt","updatedAt",description
    )
    VALUES($1,$2,$3,$4,NOW(),NOW(),$5)
    `,
    [
      opts.organizationId,
      opts.clientId,
      opts.points,
      opts.expiresAtISO ? new Date(opts.expiresAtISO) : null,
      opts.description ?? null,
    ],
  );
}

async function notifyViaOutbox(opts: {
  organizationId: string;
  type: NotificationType;
  trigger?: string | null;
  channels: NotificationChannel[];
  payload: {
    message: string;
    subject?: string;
    variables?: Record<string, string>;
    country?: string | null;
    userId?: string | null;
    clientId?: string | null;
    url?: string | null;
    ticketId?: string | null;
  };
}) {
  await enqueueNotificationFanout({
    organizationId: opts.organizationId,
    orderId: null,
    type: opts.type,
    trigger: opts.trigger ?? null,
    channels: opts.channels,
    payload: opts.payload,
  });
}

/* ───────────────────── Engine runner ─────────────────────────────── */

export type RuleExecutionResult = {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  actionsExecuted: string[];
};

export async function runMagicRules(
  event: EventPayload,
  rules: MagicRule[],
): Promise<RuleExecutionResult[]> {
  const results: RuleExecutionResult[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }
    if (!rule.match.anyOfEvents.includes(event.type)) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }

    const ok = (rule.conditions || []).every((c) => checkCondition(c, event));
    if (!ok) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }

    const executed: string[] = [];

    for (const action of rule.actions) {
      switch (action.kind) {
        case "send_message_with_coupon": {
          const coupon = await createCouponForOrg(event.organizationId, action);
          const vars: Record<string, string> = {
            coupon_code: coupon.code,
            coupon_expires: coupon.expirationDate ? new Date(coupon.expirationDate).toISOString().slice(0, 10) : "",
            client_id: event.clientId,
            order_id: (event as any).orderId ?? "",
          };
          await notifyViaOutbox({
            organizationId: event.organizationId,
            type: "order_message",
            trigger: null,
            channels: action.channels as NotificationChannel[],
            payload: {
              subject: applyVars(action.subject, vars),
              message: applyVars(action.htmlTemplate, vars),
              variables: vars,
              country: event.country ?? null,
              userId: event.userId ?? null,
              clientId: event.clientId,
              url: null,
              ticketId: null,
            },
          });
          executed.push("send_message_with_coupon");
          break;
        }

        case "recommend_product": {
          const vars: Record<string, string> = {
            product_id: action.productId,
            client_id: event.clientId,
            order_id: (event as any).orderId ?? "",
          };
          await notifyViaOutbox({
            organizationId: event.organizationId,
            type: "order_message",
            trigger: null,
            channels: action.channels as NotificationChannel[],
            payload: {
              subject: applyVars(action.subject, vars),
              message: applyVars(action.htmlTemplate, vars),
              variables: vars,
              country: event.country ?? null,
              userId: event.userId ?? null,
              clientId: event.clientId,
              url: null,
              ticketId: null,
            },
          });
          executed.push("recommend_product");
          break;
        }

        case "grant_affiliate_points": {
          await grantAffiliatePointsOnce({
            organizationId: event.organizationId,
            clientId: event.clientId,
            points: action.points,
            action: action.action,
            description: action.description ?? null,
          });
          executed.push(`grant_affiliate_points:${action.points}`);
          break;
        }

        case "multiply_affiliate_points_for_order": {
          const base = event.type === "order_paid" ? (event.baseAffiliatePointsAwarded ?? 0) : 0;
          if (base > 0 && action.multiplier !== 1) {
            const extra = Math.round(base * (action.multiplier - 1));
            if (extra !== 0) {
              await grantAffiliatePointsOnce({
                organizationId: event.organizationId,
                clientId: event.clientId,
                points: extra,
                action: action.action,
                description: action.description ?? `Multiplier x${action.multiplier}`,
              });
            }
          }
          executed.push(`multiply_affiliate_points_for_order:x${action.multiplier}`);
          break;
        }

        case "queue_next_order_points": {
          await queueNextOrderPoints({
            organizationId: event.organizationId,
            clientId: event.clientId,
            points: action.points,
            description: action.description ?? null,
            expiresAtISO: action.expiresAtISO ?? null,
          });
          executed.push(`queue_next_order_points:${action.points}`);
          break;
        }
      }
    }

    results.push({ ruleId: rule.id, ruleName: rule.name, matched: true, actionsExecuted: executed });

    // STOP ON MATCH is always true now
    break;
  }

  return results;
}

/* ───────────── Helper: load rules & run engine for an order ───────────── */

export async function evaluateRulesForOrder(opts: {
  organizationId: string;
  orderId: string;
  event: MagicEventType; // "order_paid" only
}) {
  const { organizationId, orderId, event } = opts;
  if (event !== "order_paid") return [];

  // 1) Load order
  const { rows: [o] } = await pool.query(
    `SELECT id,"clientId",country,"datePaid","dateCreated","cartId"
       FROM orders
      WHERE id = $1 AND "organizationId" = $2
      LIMIT 1`,
    [orderId, organizationId],
  );
  if (!o) return [];

  // 2) Product ids
  const { rows: pRows } = await pool.query(
    `SELECT COALESCE("productId","affiliateProductId") AS pid
       FROM "cartProducts"
      WHERE "cartId" = $1`,
    [o.cartId],
  );
  const purchasedProductIds = pRows.map((r) => String(r.pid)).filter(Boolean);

  // 3) Compute inactivity (days since previous order before/at this time)
  const purchasedAt = new Date(o.datePaid ?? o.dateCreated);
  const purchasedAtISO = purchasedAt.toISOString();
  const { rows: [prev] } = await pool.query(
    `SELECT MAX(COALESCE("datePaid","dateCreated")) AS last
       FROM orders
      WHERE "organizationId" = $1
        AND "clientId" = $2
        AND id <> $3
        AND COALESCE("datePaid","dateCreated") <= $4`,
    [organizationId, o.clientId, orderId, purchasedAt],
  );
  const last = prev?.last ? new Date(prev.last) : null;
  const daysSinceLastPurchase = last
    ? Math.floor((purchasedAt.getTime() - last.getTime()) / (1000 * 60 * 60 * 24))
    : undefined;

  const eventPayload: EventPayload = {
    organizationId,
    clientId: o.clientId,
    country: o.country,
    type: "order_paid",
    orderId,
    purchasedProductIds,
    purchasedAtISO,
    daysSinceLastPurchase,
  };

  const now = new Date();

  // 3b) Auto-consume any queued boosters on THIS order
  {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: boosters } = await client.query(
        `
        SELECT id, points, description
          FROM "affiliatePointBoosters"
         WHERE "organizationId" = $1
           AND "clientId" = $2
           AND "consumedAt" IS NULL
           AND ("expiresAt" IS NULL OR "expiresAt" >= $3)
        FOR UPDATE
        `,
        [organizationId, o.clientId, purchasedAt],
      );

      if (boosters.length) {
        const total = boosters.reduce((s, b) => s + (b.points || 0), 0);
        // award in one go
        await client.query(
          `
          INSERT INTO "affiliatePointLogs"(
            id,"organizationId","clientId",points,action,description,"sourceClientId",
            "createdAt","updatedAt"
          )
          VALUES(gen_random_uuid(),$1,$2,$3,$4,$5,NULL,NOW(),NOW())
          `,
          [
            organizationId,
            o.clientId,
            total,
            "next_order_bonus",
            `Auto-applied ${boosters.length} booster(s) on order ${orderId}`,
          ],
        );
        // update balances
        await client.query(
          `
          INSERT INTO "affiliatePointBalances"(
            "clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt"
          )
          VALUES($1,$2,$3,0,NOW(),NOW())
          ON CONFLICT("clientId","organizationId") DO UPDATE SET
            "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
            "updatedAt"     = NOW()
          `,
          [o.clientId, organizationId, total],
        );
        // mark boosters consumed
        await client.query(
          `
          UPDATE "affiliatePointBoosters"
             SET "consumedAt" = NOW(), "consumedOrderId" = $1, "updatedAt" = NOW()
           WHERE id = ANY($2::uuid[])
          `,
          [orderId, boosters.map((b: any) => b.id)],
        );
      }

      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // 4) Load rules for base/order_paid only
  const { rows: ruleRows } = await pool.query(
    `SELECT id, name, description, event, scope,
            "isEnabled" AS enabled,
            "runOncePerOrder",
            "startDate","endDate",
            conditions, actions
       FROM "magicRules"
      WHERE "organizationId" = $1
        AND event = 'order_paid'
        AND scope = 'base'
      ORDER BY "updatedAt" DESC
      LIMIT 500`,
    [organizationId],
  );

  // 5) Filter by schedule window and run-once
  const rulesToRun: { rule: MagicRule; meta: { id: string } }[] = [];
  for (const r of ruleRows) {
    const startOk = !r.startDate || new Date(r.startDate) <= now;
    const notExpired = !r.endDate || new Date(r.endDate) >= now;

    // auto-disable if expired
    if (r.endDate && new Date(r.endDate) < now && r.enabled) {
      await pool.query(
        `UPDATE "magicRules" SET "isEnabled" = FALSE, "updatedAt" = NOW() WHERE id = $1`,
        [r.id],
      );
    }

    if (!r.enabled || !startOk || !notExpired) continue;

    // ALWAYS run once per order → skip if already executed
    const { rowCount } = await pool.query(
      `SELECT 1 FROM "magicRuleExecutions" WHERE "ruleId" = $1 AND "orderId" = $2 LIMIT 1`,
      [r.id, orderId],
    );
    if (rowCount > 0) continue;

    const rule: MagicRule = {
      id: r.id,
      name: r.name || r.id,
      enabled: true,
      match: { anyOfEvents: ["order_paid"] },
      conditions: Array.isArray(r.conditions) ? r.conditions : JSON.parse(r.conditions ?? "[]"),
      actions: Array.isArray(r.actions) ? r.actions : JSON.parse(r.actions ?? "[]"),
      stopAfterMatch: true,
    };

    rulesToRun.push({ rule, meta: { id: r.id } });
  }

  if (!rulesToRun.length) return [];

  // 6) Run engine (will stop after first match)
  const results = await runMagicRules(eventPayload, rulesToRun.map((x) => x.rule));

  // 7) Persist execution for the matched rule (if it fired)
  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const meta = rulesToRun[i]?.meta;
    if (!meta) continue;
    const fired = res.matched && res.actionsExecuted.length > 0;
    if (fired) {
      await pool.query(
        `INSERT INTO "magicRuleExecutions" ("ruleId","orderId","organizationId","createdAt")
         VALUES ($1,$2,$3,NOW())
         ON CONFLICT ("ruleId","orderId") DO NOTHING`,
        [meta.id, orderId, organizationId],
      );
      break; // stop after recording the first (only) match
    }
  }

  return results;
}
