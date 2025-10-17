import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const CreateSchema = z.object({
  name: z.string().min(1),
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

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  // ⬇️ include template name directly
  const { rows } = await pool.query(
    `SELECT s.*, t.name AS "templateName"
       FROM stores s
       LEFT JOIN "posReceiptTemplates" t
         ON t.id = s."defaultReceiptTemplateId"
        AND t."organizationId" = s."organizationId"
      WHERE s."organizationId" = $1
      ORDER BY s."createdAt" DESC`,
    [ctx.organizationId]
  );

  const stores = rows.map((r: any) => ({
    ...r,
    address: parseJSONish(r.address),
  }));

  return NextResponse.json({ stores }, { status: 200 });
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
    const cleanAddress = parseJSONish(body.address) ?? {};

    // ⬇️ return the templateName in one roundtrip
    const { rows } = await pool.query(
      `INSERT INTO stores
         (id,"organizationId",name,address,"defaultReceiptTemplateId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
       RETURNING stores.*,
         (SELECT name
            FROM "posReceiptTemplates" t
           WHERE t.id = stores."defaultReceiptTemplateId"
             AND t."organizationId" = stores."organizationId") AS "templateName"`,
      [id, ctx.organizationId, body.name, cleanAddress, body.defaultReceiptTemplateId ?? null]
    );

    const store = { ...rows[0], address: parseJSONish(rows[0].address) };
    return NextResponse.json({ store }, { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: e?.message ?? "Unable to create store" }, { status: 500 });
  }
}
