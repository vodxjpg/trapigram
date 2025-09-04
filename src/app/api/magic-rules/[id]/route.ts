// src/app/api/magic-rules/[id]/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  event: z.enum([
    "order_paid","order_completed","order_cancelled",
    "order_refunded","order_underpaid","order_open","order_status_changed"
  ]).optional(),
  scope: z.enum(["base","supplier","both"]).optional(),
  priority: z.number().int().min(0).optional(),
  runOncePerOrder: z.boolean().optional(),
  stopOnMatch: z.boolean().optional(),
  isEnabled: z.boolean().optional(),
  conditions: z.any().optional(),
  actions: z.any().optional(),
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(_req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rows } = await pool.query(
    `SELECT * FROM "magicRules" WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [params.id, organizationId],
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: rows[0] }, { status: 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
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

  // Build dynamic SET clause
  const sets: string[] = [];
  const vals: any[] = [];
  const push = (frag: string, v: any) => { sets.push(frag); vals.push(v); };

  if (body.name !== undefined) push(`name = $${vals.length + 1}`, body.name);
  if (body.description !== undefined) push(`description = $${vals.length + 1}`, body.description);
  if (body.event !== undefined) push(`event = $${vals.length + 1}`, body.event);
  if (body.scope !== undefined) push(`scope = $${vals.length + 1}`, body.scope);
  if (body.priority !== undefined) push(`priority = $${vals.length + 1}`, body.priority);
  if (body.runOncePerOrder !== undefined) push(`"runOncePerOrder" = $${vals.length + 1}`, body.runOncePerOrder);
  if (body.stopOnMatch !== undefined) push(`"stopOnMatch" = $${vals.length + 1}`, body.stopOnMatch);
  if (body.isEnabled !== undefined) push(`"isEnabled" = $${vals.length + 1}`, body.isEnabled);
  if (body.conditions !== undefined) push(`conditions = $${vals.length + 1}`, JSON.stringify(body.conditions));
  if (body.actions !== undefined) push(`actions = $${vals.length + 1}`, JSON.stringify(body.actions));
  push(`"updatedAt" = NOW()`, null); // no param, just a fragment

  if (!sets.length) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Replace the null we pushed for updatedAt with correct text
  const idx = sets.indexOf(`"updatedAt" = NOW()`);
  if (idx > -1) sets[idx] = `"updatedAt" = NOW()`;

  vals.push(params.id, organizationId);

  const sql = `
    UPDATE "magicRules"
       SET ${sets.join(", ")}
     WHERE id = $${vals.length - 1} AND "organizationId" = $${vals.length}
     RETURNING *`;

  const { rows } = await pool.query(sql, vals);
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ rule: rows[0] }, { status: 200 });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { rowCount } = await pool.query(
    `DELETE FROM "magicRules" WHERE id = $1 AND "organizationId" = $2`,
    [params.id, organizationId],
  );
  if (!rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
