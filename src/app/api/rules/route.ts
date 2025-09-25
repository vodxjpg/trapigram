import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const channelsEnum = z.enum(["email", "telegram"]);
const eventEnum = z.enum([
  "order_placed", "order_pending_payment", "order_paid", "order_completed",
  "order_cancelled", "order_refunded", "order_partially_paid", "order_shipped",
  "order_message", "ticket_created", "ticket_replied", "manual", "customer_inactive",
]);

const scopeEnum = z.enum(["per_order", "per_customer"]);

const conditionsSchema = z
  .object({
    op: z.enum(["AND", "OR"]),
    items: z.array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("contains_product"), productIds: z.array(z.string()).min(1) }),
        z.object({ kind: z.literal("order_total_gte_eur"), amount: z.coerce.number().min(0) }),
        z.object({ kind: z.literal("no_order_days_gte"), days: z.coerce.number().int().min(1) }),
      ])
    ).min(1),
  })
  .partial()
  .refine(v => !v.items || !!v.op, { message: "Provide op when items exist", path: ["op"] });

/** legacy single-action payloads */
const sendCouponPayload = z.object({
  couponId: z.string().min(1),
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(),
  conditions: conditionsSchema.optional(),
  scope: scopeEnum.optional(), // NEW
});
const productRecoPayload = z.object({
  productIds: z.array(z.string()).optional(),
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(),
  conditions: conditionsSchema.optional(),
  scope: scopeEnum.optional(), // NEW
});

/** helpers */
// Coerce to number, ensure <= 1 decimal, and > 0 without using .gt (for broader Zod compat)
const positiveOneDecimal = z
  .coerce.number()
  .refine((n) => Number.isFinite(n) && Math.round(n * 10) === n * 10, {
    message: "Must have at most one decimal place",
  })
  .refine((n) => n > 0, { message: "Points must be > 0" });

/** new multi-action payload (supports 4 action types) */
const multiPayload = z.object({
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(),
  conditions: conditionsSchema.optional(),
  actions: z.array(
    z.discriminatedUnion("type", [
      z.object({
        type: z.literal("send_coupon"),
        payload: z.object({ couponId: z.string().min(1) }).optional(),
      }),
      z.object({
        type: z.literal("product_recommendation"),
        payload: z.object({ productIds: z.array(z.string()).min(1) }).optional(),
      }),
         z.object({
     type: z.literal("multiply_points"),
     payload: z.object({
       // avoid .gt for older Zod; use refine instead
       factor: z.coerce.number().refine((n) => n > 0, {
         message: "Multiplier must be > 0",
       }),
       description: z.string().optional(),
     }),
   }),
         z.object({
     type: z.literal("award_points"),
     payload: z.object({
       points: positiveOneDecimal,
       description: z.string().optional(),
     }),
   }),
    ])
  ).min(1, "Add at least one action"),
  scope: scopeEnum.optional(), // NEW
});

const baseRule = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),
  event: eventEnum,
  countries: z.array(z.string()).optional().default([]),
  channels: z.array(channelsEnum).min(1),
});

const createSchema = z.discriminatedUnion("action", [
  baseRule.extend({ action: z.literal("send_coupon"), payload: sendCouponPayload }),
  baseRule.extend({ action: z.literal("product_recommendation"), payload: productRecoPayload }),
  baseRule.extend({ action: z.literal("multi"), payload: multiPayload }),
]);

function couponCoversCountries(couponCountries: string[], ruleCountries: string[]) {
  if (!ruleCountries?.length) return true;
  if (!couponCountries?.length) return false;
  return ruleCountries.every((c) => couponCountries.includes(c));
}

export async function GET(req: NextRequest) { /* unchanged */ }

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);

    // validate condition kinds allowed by event
    const items = parsed.payload?.conditions?.items ?? [];
    const ev = parsed.event as string;

    // business constraints for the two new actions
    if (parsed.action === "multi" && Array.isArray(parsed.payload?.actions)) {
      // multiply_points only valid on order_* events
      if (
        ev === "customer_inactive" &&
        parsed.payload.actions.some((a: any) => a.type === "multiply_points")
      ) {
        return NextResponse.json(
          { error: "Action 'multiply_points' is only valid for order events." },
          { status: 400 }
        );
      }
      // award_points is allowed on order_* and customer_inactive (buyer only)
      // nothing else to validate here
    }

    if (/^order_/.test(ev) && items.some((i: any) => i.kind === "no_order_days_gte")) {
      return NextResponse.json(
        { error: "Condition 'no_order_days_gte' is not valid for order events." },
        { status: 400 }
      );
    }
    if (ev === "customer_inactive" && items.some((i: any) => i.kind !== "no_order_days_gte")) {
      return NextResponse.json(
        { error: "Only 'no_order_days_gte' is allowed for 'customer_inactive'." },
        { status: 400 }
      );
    }

    // scope validation
    const scope = parsed.payload?.scope as "per_order" | "per_customer" | undefined;
    if (ev === "customer_inactive" && scope === "per_order") {
      return NextResponse.json(
        { error: "Scope 'per_order' is not allowed for 'customer_inactive'." },
        { status: 400 }
      );
    }

    // coupon-country compatibility (legacy single + multi)
    const ruleCountries = parsed.countries ?? [];
    const couponIdsToCheck: string[] = [];

    if (parsed.action === "send_coupon") {
      couponIdsToCheck.push(parsed.payload.couponId);
    } else if (parsed.action === "multi") {
      for (const a of parsed.payload.actions) {
        if (a.type === "send_coupon" && a.payload?.couponId) {
          couponIdsToCheck.push(a.payload.couponId);
        }
      }
    }

    if (couponIdsToCheck.length) {
      const unique = [...new Set(couponIdsToCheck.filter(Boolean))];
      if (unique.length) {
        const { rows } = await pool.query(
          `SELECT id, countries FROM coupons
            WHERE "organizationId" = $1 AND id = ANY($2::uuid[])`,
          [organizationId, unique],
        );
        const map = new Map(rows.map(r => [String(r.id), Array.isArray(r.countries) ? r.countries : JSON.parse(r.countries || "[]")]));
        for (const cid of unique) {
          const cc = map.get(String(cid));
          if (!cc) {
            return NextResponse.json({ error: "Coupon not found for this organization." }, { status: 400 });
          }
          if (!couponCoversCountries(cc, ruleCountries)) {
            const missing = ruleCountries.filter((c) => !cc.includes(c));
            return NextResponse.json({ error: `Coupon isn’t valid for: ${missing.join(", ")}` }, { status: 400 });
          }
        }
      }
    }

    const id = crypto.randomUUID();
    const res = await pool.query(
      `INSERT INTO "automationRules"
         (id,"organizationId",name,description,enabled,priority,event,
          countries,action,channels,payload,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,
               $8,$9,$10,$11,NOW(),NOW())
       RETURNING *`,
      [
        id,
        organizationId,
        parsed.name,
        parsed.description ?? "",
        parsed.enabled ?? true,
        parsed.priority ?? 100,
        parsed.event,
        JSON.stringify(parsed.countries ?? []),
        parsed.action,
        JSON.stringify(parsed.channels ?? []),
        JSON.stringify(parsed.payload ?? {}),
      ],
    );

    const row = res.rows[0];
    row.countries = JSON.parse(row.countries || "[]");
    row.channels = JSON.parse(row.channels || "[]");
    row.payload = typeof row.payload === "string" ? JSON.parse(row.payload || "{}") : (row.payload ?? {});
    return NextResponse.json(row, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/rules] error", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
