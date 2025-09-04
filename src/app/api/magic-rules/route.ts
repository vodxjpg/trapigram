// src/app/api/magic-rules/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const CreateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  event: z.enum([
    "order_paid","order_completed","order_cancelled",
    "order_refunded","order_underpaid","order_open","order_status_changed"
  ]),
  scope: z.enum(["base","supplier","both"]).default("both"),
  priority: z.number().int().min(0).default(100),
  runOncePerOrder: z.boolean().default(true),
  stopOnMatch: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  conditions: z.any().default([]), // already parsed by your form
  actions: z.any().default([]),
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
           "runOncePerOrder","stopOnMatch","isEnabled","updatedAt"
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
        "runOncePerOrder","stopOnMatch",scope,"isEnabled","createdAt","updatedAt")
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     RETURNING *`,
    [
      id,
      organizationId,
      body.name,
      body.description ?? null,
      body.event,
      JSON.stringify(body.conditions ?? []),
      JSON.stringify(body.actions ?? []),
      body.priority ?? 100,
      body.runOncePerOrder ?? true,
      body.stopOnMatch ?? false,
      body.scope ?? "both",
      body.isEnabled ?? true,
      now,
    ],
  );

  return NextResponse.json({ rule: rows[0] }, { status: 201 });
}
