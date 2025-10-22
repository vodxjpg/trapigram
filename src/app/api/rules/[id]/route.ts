// src/app/api/rules/[id]/route.ts
export const runtime = "nodejs";

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

const conditionsSchema = z.object({
  op: z.enum(["AND", "OR"]),
  items: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("contains_product"), productIds: z.array(z.string()).min(1) }),
      z.object({ kind: z.literal("order_total_gte_eur"), amount: z.coerce.number().min(0) }),
      z.object({ kind: z.literal("no_order_days_gte"), days: z.coerce.number().int().min(1) }),
    ])
  ).min(1),
}).partial();

const positiveOneDecimal = z
  .coerce.number()
  .refine((n) => Number.isFinite(n) && Math.round(n * 10) === n * 10, {
    message: "Must have at most one decimal place",
  })
  .refine((n) => n > 0, { message: "Points must be > 0" });

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
  ).min(1),
  scope: scopeEnum.optional(),
}).partial();

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).optional(),
  event: eventEnum.optional(),
  countries: z.array(z.string()).optional(),
  action: z.enum(["send_coupon", "product_recommendation", "multi"]).optional(),
  channels: z.array(channelsEnum).optional(),
  payload: z
    .union([multiPayload, z.record(z.any())])
    .optional()
    .refine((p) => {
      if (!p || !("conditions" in (p as any))) return true;
      const r = conditionsSchema.safeParse((p as any).conditions);
      return r.success;
    }, { message: "Invalid payload.conditions" }),
});

function couponCoversCountries(couponCountries: string[], ruleCountries: string[]) {
  if (!ruleCountries?.length) return true;
  if (!couponCountries?.length) return false;
  return ruleCountries.every((c) => couponCountries.includes(c));
}

/* ─────────────────── GET ─────────────────── */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { rows } = await pool.query(
      `SELECT id, name, event, enabled, priority, countries, action, channels, payload, "updatedAt"
         FROM "automationRules"
        WHERE id = $1 AND "organizationId" = $2
        LIMIT 1`,
      [id, organizationId],
    );
    if (!rows.length) {
      return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    }
    const r = rows[0];
    const rule = {
      ...r,
      countries: Array.isArray(r.countries) ? r.countries : JSON.parse(r.countries || "[]"),
      channels: Array.isArray(r.channels) ? r.channels : JSON.parse(r.channels || "[]"),
      payload: typeof r.payload === "string" ? JSON.parse(r.payload || "{}") : (r.payload ?? {}),
    };
    return NextResponse.json(rule);
  } catch (e) {
    console.error("[GET /api/rules/:id] error", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────────── PATCH ─────────────────── */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsed = updateSchema.parse(body);

    // Load existing to compute final values for validation
    const { rows: [existing] } = await pool.query(
      `SELECT countries, action, event, payload
         FROM "automationRules"
        WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId]
    );
    if (!existing) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const finalCountries: string[] =
      parsed.countries ?? (Array.isArray(existing.countries) ? existing.countries : JSON.parse(existing.countries || "[]"));
    const finalAction: string = parsed.action ?? existing.action;
    const finalEvent: string = parsed.event ?? existing.event;
    const finalPayload: any =
      parsed.payload ??
      (typeof existing.payload === "string" ? JSON.parse(existing.payload || "{}") : existing.payload || {});

    // Validate condition kinds vs event
    const cItems = finalPayload?.conditions?.items ?? [];
    if (/^order_/.test(finalEvent) && cItems.some((i: any) => i.kind === "no_order_days_gte")) {
      return NextResponse.json(
        { error: "Condition 'no_order_days_gte' is not valid for order events." },
        { status: 400 }
      );
    }
    if (finalEvent === "customer_inactive" && cItems.some((i: any) => i.kind !== "no_order_days_gte")) {
      return NextResponse.json(
        { error: "Only 'no_order_days_gte' is allowed for 'customer_inactive'." },
        { status: 400 }
      );
    }

    // Action/event compatibility
    if (finalAction === "multi" && Array.isArray(finalPayload?.actions)) {
      if (
        finalEvent === "customer_inactive" &&
        finalPayload.actions.some((a: any) => a?.type === "multiply_points")
      ) {
        return NextResponse.json(
          { error: "Action 'multiply_points' is only valid for order events." },
          { status: 400 }
        );
      }
    }

    // Scope validation
    if (finalEvent === "customer_inactive" && finalPayload?.scope === "per_order") {
      return NextResponse.json(
        { error: "Scope 'per_order' is not allowed for 'customer_inactive'." },
        { status: 400 }
      );
    }

    // Coupon coverage check
    const couponIds: string[] = [];
    if (finalAction === "send_coupon" && finalPayload?.couponId) {
      couponIds.push(finalPayload.couponId);
    }
    if (finalAction === "multi" && Array.isArray(finalPayload?.actions)) {
      for (const a of finalPayload.actions) {
        if (a?.type === "send_coupon" && a?.payload?.couponId) {
          couponIds.push(a.payload.couponId);
        }
      }
    }
    if (couponIds.length) {
      const unique = [...new Set(couponIds)];
      const { rows } = await pool.query(
        `SELECT id, countries FROM coupons
         WHERE "organizationId" = $1 AND id = ANY($2::text[])`,
        [organizationId, unique],
      );
      const map = new Map(
        rows.map(r => [
          String(r.id),
          Array.isArray(r.countries) ? r.countries : JSON.parse(r.countries || "[]"),
        ])
      );
      for (const cid of unique) {
        const cc = map.get(String(cid));
        if (!cc) return NextResponse.json({ error: "Coupon not found for this organization." }, { status: 400 });
        if (!couponCoversCountries(cc, finalCountries)) {
          const missing = finalCountries.filter((c: string) => !cc.includes(c));
          return NextResponse.json({ error: `Coupon isn’t valid for: ${missing.join(", ")}` }, { status: 400 });
        }
      }
    }

    // Build UPDATE
    const updates: string[] = [];
    const values: any[] = [];
    let i = 1;

    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      if (key === "countries" || key === "channels") {
        updates.push(`"${key}" = $${i++}`); values.push(JSON.stringify(value));
      } else if (key === "payload") {
        updates.push(`"payload" = $${i++}`); values.push(JSON.stringify(value));
      } else {
        updates.push(`"${key}" = $${i++}`); values.push(value);
      }
    }

    if (!updates.length) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    values.push(id, organizationId);
    const res = await pool.query(
      `UPDATE "automationRules"
          SET ${updates.join(", ")}, "updatedAt" = NOW()
        WHERE id = $${i++} AND "organizationId" = $${i}
      RETURNING *`,
      values,
    );
    if (!res.rowCount) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    const row = res.rows[0];
    row.countries = JSON.parse(row.countries || "[]");
    row.channels = JSON.parse(row.channels || "[]");
    row.payload = typeof row.payload === "string" ? JSON.parse(row.payload || "{}") : (row.payload ?? {});
    return NextResponse.json(row);
  } catch (error: any) {
    console.error("[PATCH /api/rules/:id] error", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────────── DELETE ─────────────────── */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const res = await pool.query(
      `DELETE FROM "automationRules" WHERE id = $1 AND "organizationId" = $2 RETURNING id`,
      [id, organizationId],
    );
    if (!res.rowCount) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/rules/:id] error", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
