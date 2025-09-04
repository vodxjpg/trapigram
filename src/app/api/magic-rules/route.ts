// src/app/api/magic-rules/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const ConditionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("always") }),
  z.object({
    kind: z.literal("purchased_product_in_list"),
    productIds: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    kind: z.literal("purchase_time_in_window"),
    fromHour: z.number().int().min(0).max(23),
    toHour: z.number().int().min(0).max(23),
    inclusive: z.boolean().default(true),
  }),
]);

const ActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("send_message_with_coupon"),
    subject: z.string().min(1),
    htmlTemplate: z.string().min(1),
    channels: z.array(z.enum(["email","in_app","webhook","telegram"] as const)).min(1),
    coupon: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      discountType: z.enum(["fixed","percentage"]),
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
    channels: z.array(z.enum(["email","in_app","webhook","telegram"] as const)).min(1),
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
]);

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  // UX is fixed; we force these on save:
  event: z.literal("order_paid").optional(),
  scope: z.literal("base").optional(),
  priority: z.number().int().min(0).default(100),
  runOncePerOrder: z.boolean().default(true),
  stopOnMatch: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  conditions: z.array(ConditionSchema).default([]),
  actions: z.array(ActionSchema).min(1),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { searchParams } = new URL(req.url);
  const search = (searchParams.get("search") ?? "").trim();

  const like = `%${search}%`;
  const params: any[] = [organizationId];
  let where = `WHERE "organizationId" = $1`;
  if (search) {
    params.push(like, like);
    where += ` AND (name ILIKE $2 OR event ILIKE $3)`;
  }

  const sql = `
    SELECT id, name, event, scope, priority,
           "runOncePerOrder","stopOnMatch","isEnabled",
           "startDate","endDate",
           "updatedAt"
      FROM "magicRules"
      ${where}
      ORDER BY priority ASC, "updatedAt" DESC
      LIMIT 200`;

  const { rows } = await pool.query(sql, params);
  return NextResponse.json({ rules: rows }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  let body: z.infer<typeof CreateSchema>;
  try {
    body = CreateSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const id = uuidv4();
  const now = new Date();

  const { rows } = await pool.query(
    `INSERT INTO "magicRules"
       (id,"organizationId",name,description,event,conditions,actions,priority,
        "runOncePerOrder","stopOnMatch",scope,"isEnabled","startDate","endDate",
        "createdAt","updatedAt")
     VALUES
       ($1,$2,$3,$4,'order_paid',$5,$6,$7,$8,$9,'base',$10,$11,$12,$13,$13)
     RETURNING *`,
    [
      id,
      organizationId,
      body.name,
      body.description ?? null,
      JSON.stringify(body.conditions ?? []),
      JSON.stringify(body.actions ?? []),
      body.priority ?? 100,
      body.runOncePerOrder ?? true,
      body.stopOnMatch ?? false,
      body.isEnabled ?? true,
      body.startDate ? new Date(body.startDate) : null,
      body.endDate ? new Date(body.endDate) : null,
      now,
    ],
  );

  return NextResponse.json({ rule: rows[0] }, { status: 201 });
}
