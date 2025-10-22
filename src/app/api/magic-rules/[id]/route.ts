// src/app/api/magic-rules/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* ─────────────── Schemas ─────────────── */
const ConditionSchema = z.discriminatedUnion("kind", [
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
  }),
]);

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send_message_with_coupon"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1),
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
      startDateISO: z.string().nullable().optional(),
      expirationDateISO: z.string().nullable().optional(),
    }),
  }),
  z.object({
    kind: z.literal("recommend_product"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1),
    channels: z.array(z.enum(["email", "telegram"] as const)).min(1),
    productId: z.string().min(1),
  }),
  z.object({
    kind: z.literal("grant_affiliate_points"),
    points: z.number().int(),
    action: z.string().min(1),
    description: z.string().nullable().optional(),
  }),
  z.object({
    kind: z.literal("multiply_affiliate_points_for_order"),
    multiplier: z.number().positive(),
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

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isEnabled: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  conditions: z.array(ConditionSchema).optional(),
  actions: z.array(ActionSchema).optional(),
});

/* ─────────────── GET ─────────────── */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is a Promise
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { rows } = await pool.query(
      `SELECT * FROM "magicRules" WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, organizationId]
    );
    if (!rows.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule: rows[0] }, { status: 200 });
  } catch (e) {
    console.error("[GET /api/magic-rules/[id]]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────── PATCH ─────────────── */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  let body: z.infer<typeof UpdateSchema>;
  try {
    body = UpdateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const sets: string[] = [];
  const vals: any[] = [];
  const push = (frag: string, v: any) => {
    sets.push(frag.replace("$$", String(vals.length + 1)));
    vals.push(v);
  };

  if (body.name !== undefined) push(`name = $$`, body.name);
  if (body.description !== undefined) push(`description = $$`, body.description);
  if (body.isEnabled !== undefined) push(`"isEnabled" = $$`, body.isEnabled);
  if (body.startDate !== undefined)
    push(`"startDate" = $$`, body.startDate ? new Date(body.startDate) : null);
  if (body.endDate !== undefined)
    push(`"endDate" = $$`, body.endDate ? new Date(body.endDate) : null);
  if (body.conditions !== undefined)
    push(`conditions = $$`, JSON.stringify(body.conditions));
  if (body.actions !== undefined)
    push(`actions = $$`, JSON.stringify(body.actions));

  // always update timestamp
  sets.push(`"updatedAt" = NOW()`);

  if (sets.length === 1) {
    // only updatedAt
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  try {
    const idIndex = vals.length + 1;
    const orgIndex = vals.length + 2;
    vals.push(id, organizationId);

    const sql = `
      UPDATE "magicRules"
         SET ${sets.join(", ")}
       WHERE id = $${idIndex} AND "organizationId" = $${orgIndex}
       RETURNING *`;

    const { rows } = await pool.query(sql, vals);
    if (!rows.length)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ rule: rows[0] }, { status: 200 });
  } catch (e) {
    console.error("[PATCH /api/magic-rules/[id]]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ─────────────── DELETE ─────────────── */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM "magicRules" WHERE id = $1 AND "organizationId" = $2`,
      [id, organizationId]
    );
    if (!rowCount)
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("[DELETE /api/magic-rules/[id]]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
