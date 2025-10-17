// src/app/api/pos/receipt-templates/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.literal("receipt").optional(),
  printFormat: z.enum(["thermal", "a4"]).optional(),
  options: z.any().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const { rows } = await pool.query(
    `SELECT * FROM "posReceiptTemplates" WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
    [id, ctx.organizationId]
  );
  if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ template: rows[0] }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  try {
    const body = UpdateSchema.parse(await req.json());
    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (body.name !== undefined) { fields.push(`name = $${i++}`); values.push(body.name); }
    if (body.type !== undefined) { fields.push(`type = $${i++}`); values.push(body.type); }
    if (body.printFormat !== undefined) { fields.push(`"printFormat" = $${i++}`); values.push(body.printFormat); }
    if (body.options !== undefined) { fields.push(`options = $${i++}`); values.push(body.options ?? {}); }

    if (!fields.length) return NextResponse.json({ ok: true }, { status: 200 });

    const sql = `UPDATE "posReceiptTemplates" SET ${fields.join(", ")}, "updatedAt" = NOW()
                  WHERE id = $${i} AND "organizationId" = $${i + 1}
                  RETURNING *`;
    values.push(id, ctx.organizationId);
    const { rows } = await pool.query(sql, values);
    if (!rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ template: rows[0] }, { status: 200 });
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: e?.message ?? "Unable to update" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  await pool.query(
    `UPDATE stores SET "defaultReceiptTemplateId" = NULL
      WHERE "organizationId" = $1 AND "defaultReceiptTemplateId" = $2`,
    [ctx.organizationId, id]
  );

  const r = await pool.query(
    `DELETE FROM "posReceiptTemplates" WHERE id = $1 AND "organizationId" = $2`,
    [id, ctx.organizationId]
  );
  if (!r.rowCount) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true }, { status: 200 });
}
