import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const channelsEnum = z.enum(["email", "telegram"]); // ⬅️ only these two
const actionEnum = z.enum(["send_coupon", "product_recommendation"]);
const eventEnum = z.enum([
  "order_placed","order_pending_payment","order_paid","order_completed",
  "order_cancelled","order_refunded","order_partially_paid","order_shipped",
  "order_message","ticket_created","ticket_replied","manual",
  "customer_inactive", // ⬅️ new trigger
]);

const conditionsSchema = z.object({
  op: z.enum(["AND","OR"]),
  items: z.array(
    z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("contains_product"), productIds: z.array(z.string()).min(1) }),
      z.object({ kind: z.literal("order_total_gte_eur"), amount: z.coerce.number().min(0) }),
      z.object({ kind: z.literal("no_order_days_gte"), days: z.coerce.number().int().min(1) }), // ⬅️ new
    ])
  ).min(1),
}).partial().refine(v => !v.items || !!v.op, { message: "Provide op when items exist", path: ["op"] });

const baseRule = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
  enabled: z.boolean().default(true),
  priority: z.coerce.number().int().min(0).default(100),
  event: eventEnum, // single trigger
  countries: z.array(z.string()).optional().default([]),
  channels: z.array(channelsEnum).min(1),
});

const sendCouponPayload = z.object({
  couponId: z.string().optional().nullable(),
  code: z.string().optional(),
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(),
  url: z.string().url().optional().nullable(),
  conditions: conditionsSchema.optional(),
});

const productRecoPayload = z.object({
  productIds: z.array(z.string()).optional(),
  collectionId: z.string().optional(),
  templateSubject: z.string().optional(),
  templateMessage: z.string().optional(),
  url: z.string().url().optional().nullable(),
  conditions: conditionsSchema.optional(),
});

const createSchema = z.discriminatedUnion("action", [
  baseRule.extend({ action: z.literal("send_coupon"), payload: sendCouponPayload }),
  baseRule.extend({ action: z.literal("product_recommendation"), payload: productRecoPayload }),
]);

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const params = new URL(req.url).searchParams;
  const page = Number(params.get("page") || 1);
  const pageSize = Number(params.get("pageSize") || 10);
  const search = params.get("search") || "";

  try {
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM "automationRules"
        WHERE "organizationId" = $1
          AND ($2 = '' OR name ILIKE $3 OR event ILIKE $3 OR action ILIKE $3)`,
      [organizationId, search, `%${search}%`],
    );
    const totalRows = Number(countRes.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const dataRes = await pool.query(
      `SELECT id,"organizationId",name,description,enabled,priority,event,
              countries,action,channels,payload,"createdAt","updatedAt"
         FROM "automationRules"
        WHERE "organizationId" = $1
          AND ($2 = '' OR name ILIKE $3 OR event ILIKE $3 OR action ILIKE $3)
        ORDER BY priority ASC, "createdAt" DESC
        LIMIT $4 OFFSET $5`,
      [organizationId, search, `%${search}%`, pageSize, (page - 1) * pageSize],
    );

    const rules = dataRes.rows.map((r) => ({
      ...r,
      countries: JSON.parse(r.countries || "[]"),
      channels: JSON.parse(r.channels || "[]"),
      payload: typeof r.payload === "string" ? JSON.parse(r.payload || "{}") : (r.payload ?? {}),
    }));
    return NextResponse.json({ rules, totalPages, currentPage: page });
  } catch (e) {
    console.error("[GET /api/rules] error", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const body = await req.json();
    const parsed = createSchema.parse(body);

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
