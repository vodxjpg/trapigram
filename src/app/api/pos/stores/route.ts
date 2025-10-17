import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const CreateSchema = z.object({
  name: z.string().min(1),
  address: z.record(z.any()).optional(),
  defaultReceiptTemplateId: z.string().uuid().nullable().optional(),
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { rows } = await pool.query(
    `SELECT * FROM stores WHERE "organizationId" = $1 ORDER BY "createdAt" DESC`,
    [ctx.organizationId]
  );
  return NextResponse.json({ stores: rows }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = CreateSchema.parse(await req.json());

    // Validate template (if provided) belongs to org
    if (body.defaultReceiptTemplateId) {
      const { rows } = await pool.query(
        `SELECT id FROM "posReceiptTemplates"
          WHERE id = $1 AND "organizationId" = $2`,
        [body.defaultReceiptTemplateId, ctx.organizationId]
      );
      if (!rows.length) {
        return NextResponse.json({ error: "Invalid defaultReceiptTemplateId" }, { status: 400 });
      }
    }

    const id = uuidv4();
    const { rows } = await pool.query(
      `INSERT INTO stores
        (id,"organizationId",name,address,"defaultReceiptTemplateId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       RETURNING *`,
      [id, ctx.organizationId, body.name, body.address ?? {}, body.defaultReceiptTemplateId ?? null]
    );
    return NextResponse.json({ store: rows[0] }, { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: e?.message ?? "Unable to create store" }, { status: 500 });
  }
}
