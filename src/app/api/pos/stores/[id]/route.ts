import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.any().optional(), // accept object or string; we'll normalize
  defaultReceiptTemplateId: z.string().uuid().nullable().optional(),
});

function parseJSONish<T = any>(v: any): T | null {
  if (v == null) return null;
  if (typeof v === "string") {
    try { return JSON.parse(v) as T; } catch { return null; }
  }
  if (typeof v === "object") return v as T;
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const { rows } = await pool.query(
    `SELECT * FROM stores WHERE id = $1 AND "organizationId" = $2`,
    [id, ctx.organizationId]
  );
  if (!rows.length) return NextResponse.json({ error: "Store not found" }, { status: 404 });

  const store = { ...rows[0], address: parseJSONish(rows[0].address) };
  return NextResponse.json({ store }, { status: 200 });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  try {
    const body = UpdateSchema.parse(await req.json());

    if (body.defaultReceiptTemplateId !== undefined && body.defaultReceiptTemplateId !== null) {
      const { rows } = await pool.query(
        `SELECT id FROM "posReceiptTemplates"
         WHERE id = $1 AND "organizationId" = $2`,
        [body.defaultReceiptTemplateId, ctx.organizationId]
      );
      if (!rows.length) {
        return NextResponse.json({ error: "Invalid defaultReceiptTemplateId" }, { status: 400 });
      }
    }

    const fields: string[] = [];
    const values: any[] = [];
    let i = 1;

    if (body.name !== undefined) {
      fields.push(`name = $${i++}`);
      values.push(body.name);
    }
    if (body.address !== undefined) {
      fields.push(`address = $${i++}`);
      values.push(parseJSONish(body.address) ?? {}); // normalize before saving
    }
    if (body.defaultReceiptTemplateId !== undefined) {
      fields.push(`"defaultReceiptTemplateId" = $${i++}`);
      values.push(body.defaultReceiptTemplateId);
    }

    if (!fields.length) return NextResponse.json({ ok: true }, { status: 200 });

    const sql = `UPDATE stores SET ${fields.join(", ")}, "updatedAt" = NOW()
                  WHERE id = $${i} AND "organizationId" = $${i + 1}
                  RETURNING *`;
    values.push(id, ctx.organizationId);

    const { rows } = await pool.query(sql, values);
    if (!rows.length) return NextResponse.json({ error: "Store not found" }, { status: 404 });

    const store = { ...rows[0], address: parseJSONish(rows[0].address) };
    return NextResponse.json({ store }, { status: 200 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: e?.message ?? "Unable to update store" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`DELETE FROM registers WHERE "organizationId" = $1 AND "storeId" = $2`, [
      ctx.organizationId, id,
    ]);
    const r = await c.query(
      `DELETE FROM stores WHERE "organizationId" = $1 AND id = $2 RETURNING id`,
      [ctx.organizationId, id]
    );
    await c.query("COMMIT");
    if (!r.rowCount) return NextResponse.json({ error: "Store not found" }, { status: 404 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    await c.query("ROLLBACK");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    c.release();
  }
}
