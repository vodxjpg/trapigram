// src/lib/magic-rules.ts
"use server";

/**
 * Magic Rules – core engine
 * ---------------------------------------------------------------
 * Evaluates rule conditions against an event payload and executes
 * actions by calling your existing subsystems:
 *  - Notifications: via enqueueNotificationFanout (email/telegram/in_app/webhook)
 *  - Coupons:       inserts into coupons table (same schema as /api/coupons)
 *  - Affiliate:     inserts into affiliatePointLogs and updates balances
 *
 * IMPORTANT:
 *  - We do NOT guess DB shapes for "last purchase" lookups. If you want to
 *    run inactivity campaigns, compute daysSinceLastPurchase externally and
 *    pass it in the event facts (see EventPayload).
 */

import { z } from "zod";
import { randomBytes } from "crypto";
import { pgPool as pool } from "@/lib/db";
import {
  enqueueNotificationFanout,
  type NotificationChannel,
  type NotificationType,
} from "@/lib/notification-outbox";

/* ─────────────────────────────── Types ─────────────────────────────── */

export type MagicEventType = "order_paid" | "manual" | "sweep";

export interface EventPayloadBase {
  organizationId: string;
  clientId: string;                 // target client
  userId?: string | null;           // optional userId (account)
  country?: string | null;          // two-letter country, optional
  /* The event "type" and event-specific facts are below */
}

export interface OrderPaidFacts {
  type: "order_paid";
  orderId: string;
  purchasedProductIds: string[];
  purchasedAtISO: string;           // ISO string
  baseAffiliatePointsAwarded?: number; // if your order flow already computed it
}

export interface ManualFacts {
  type: "manual";
  /* arbitrary manual trigger; no extra required facts */
}

export interface SweepFacts {
  type: "sweep";
  daysSinceLastPurchase?: number;   // provide this if running inactivity rules
}

export type EventFacts = OrderPaidFacts | ManualFacts | SweepFacts;

export type EventPayload = EventPayloadBase & EventFacts;

/* ─────────────────────────────── Rules ─────────────────────────────── */

export const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("always"),
  }),
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
    inclusive: z.boolean().default(true),
  }),
]);

export type Condition = z.infer<typeof ConditionSchema>;

export const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send_message_with_coupon"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1), // supports {coupon_code}, {client_id}, {order_id}
    channels: z.array(z.enum(["email", "in_app", "webhook", "telegram"] as const)),
    coupon: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      discountType: z.enum(["fixed", "percentage"]),
      discountAmount: z.number().positive(),
      usageLimit: z.number().int().min(0),
      expendingLimit: z.number().int().min(0),
      expendingMinimum: z.number().int().min(0).default(0),
      countries: z.array(z.string().min(2)).min(1), // must match your schema: at least one
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
    channels: z.array(z.enum(["email", "in_app", "webhook", "telegram"] as const)),
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
  stopAfterMatch: z.boolean().default(false),
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
      if (event.type !== "sweep") return false; // we only honor this in sweeps unless facts included
      const days = (event as SweepFacts).daysSinceLastPurchase ?? undefined;
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
      const inclusive = cond.inclusive;
      if (from === to) return inclusive; // whole-day if inclusive, else never
      // handle wrap-around windows (e.g., 22 → 3)
      if (from < to) {
        return inclusive ? hour >= from && hour <= to : hour > from && hour < to;
      } else {
        return inclusive ? hour >= from || hour <= to : hour > from || hour < to;
      }
    }

    default:
      return false;
  }
}

/* ───────────────────── Actions – implementations ──────────────────── */

/** Coupon code generator – 8 alphanumeric uppercase, collision-safe via DB check */
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

type CreatedCoupon = {
  id: string;
  code: string;
  expirationDate: string | null;
};

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
  return {
    id: row.id,
    code: row.code,
    expirationDate: row.expirationDate,
  };
}

/** Affiliate helpers: mirror your /api/affiliate/points logic safely */
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
      [
        opts.organizationId,
        opts.clientId,
        opts.points,
        opts.action,
        opts.description ?? null,
      ],
    );
    const inserted = rows[0];
    const deltaCurrent = inserted.points;
    const deltaSpent = inserted.points < 0 ? Math.abs(inserted.points) : 0;
    await applyBalanceDelta(
      opts.clientId,
      opts.organizationId,
      deltaCurrent,
      deltaSpent,
      client,
    );
    await client.query("COMMIT");
    return inserted;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/** Notification via Outbox fanout (single call with our message & channels) */
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
  const now = new Date();
  const results: RuleExecutionResult[] = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }
    // Event filter
    if (!rule.match.anyOfEvents.includes(event.type)) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }

    // Conditions
    const ok = (rule.conditions || []).every((c) => checkCondition(c, event));
    if (!ok) {
      results.push({ ruleId: rule.id, ruleName: rule.name, matched: false, actionsExecuted: [] });
      continue;
    }

    const executed: string[] = [];

    // Actions
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
          const subject = applyVars(action.subject, vars);
          const html = applyVars(action.htmlTemplate, vars);

          await notifyViaOutbox({
            organizationId: event.organizationId,
            type: "order_message", // generic user-facing message type
            trigger: null,
            channels: action.channels as NotificationChannel[],
            payload: {
              subject,
              message: html,
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
          const subject = applyVars(action.subject, vars);
          const html = applyVars(action.htmlTemplate, vars);

          await notifyViaOutbox({
            organizationId: event.organizationId,
            type: "order_message",
            trigger: null,
            channels: action.channels as NotificationChannel[],
            payload: {
              subject,
              message: html,
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
          const base = (event.type === "order_paid" ? (event.baseAffiliatePointsAwarded ?? 0) : 0);
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

        default:
          // no-op
          break;
      }
    }

    results.push({ ruleId: rule.id, ruleName: rule.name, matched: true, actionsExecuted: executed });

    if (rule.stopAfterMatch) break;
  }

  return results;
}
