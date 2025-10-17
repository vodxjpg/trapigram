// src/app/api/pos/receipt-templates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

export const runtime = "nodejs";

/* ──────────────────────────────────────────────────────────────────────
   Zod schemas
────────────────────────────────────────────────────────────────────── */
const OptionsSchema = z.object({
  showLogo: z.boolean().default(true),
  showCompanyName: z.boolean().default(true),
  headerText: z.string().max(2000).nullable().optional(),
  showStoreAddress: z.boolean().default(false),
  showCustomerAddress: z.boolean().default(false),
  showCustomerDetailsTitle: z.boolean().default(false),
  displayCompanyFirst: z.boolean().default(false),
  labels: z.object({
    item: z.string().default("Item"),
    price: z.string().default("Price"),
    subtotal: z.string().default("Subtotal"),
    discount: z.string().default("Discount"),
    tax: z.string().default("Tax"),
    total: z.string().default("Total"),
    change: z.string().default("Change"),
    outstanding: z.string().default("Outstanding"),
    servedBy: z.string().default("Served by"),
  }).default({}),
  flags: z.object({
    hideDiscountIfZero: z.boolean().default(true),
    printBarcode: z.boolean().default(true),
    showOrderKey: z.boolean().default(true),
    showCashier: z.boolean().default(true), // employee name on receipt
  }).default({}),
}).default({});

const CreateSchema = z.object({
  name: z.string().min(1),
  type: z.literal("receipt").default("receipt"),
  printFormat: z.enum(["thermal", "a4"]).default("thermal"),
  options: OptionsSchema.optional(),
});

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.literal("receipt").optional(),
  printFormat: z.enum(["thermal", "a4"]).optional(),
  options: OptionsSchema.optional(),
});

/* ──────────────────────────────────────────────────────────────────────
   GET /api/pos/receipt-templates
   Query params:
     - printFormat=thermal|a4  (optional filter)
     - q=string                (optional name search)
     - includeUsage=true       (include how many stores use each template)
     - storeId=<uuid>          (when includeUsage, flags isDefaultForStore)
────────────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId } = ctx;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const printFormat = url.searchParams.get("printFormat");
  const includeUsage = ["1", "true", "yes"].includes(
    (url.searchParams.get("includeUsage") || "").toLowerCase()
  );
  const storeId = url.searchParams.get("storeId");

  const where: string[] = [`t."organizationId" = $1`];
  const vals: any[] = [organizationId];

  if (printFormat === "thermal" || printFormat === "a4") {
    where.push(`t."printFormat" = $${vals.length + 1}`);
    vals.push(printFormat);
  }
  if (q) {
    where.push(`t.name ILIKE $${vals.length + 1}`);
    vals.push(`%${q}%`);
  }

  let sql: string;
  if (includeUsage) {
    // Add LEFT JOIN to count how many stores reference each template
    // and (optionally) whether a specific store uses it.
    const hasStoreCheck = !!storeId;
    let storeCheckFragment = "0";
    if (hasStoreCheck) {
      where.push(`1=1`); // no-op to keep placeholder math simple
      storeCheckFragment = `MAX(CASE WHEN s.id = $${vals.length + 1} THEN 1 ELSE 0 END)`;
      vals.push(storeId);
    }

    sql = `
      SELECT
        t.id, t."organizationId", t.name, t.type, t."printFormat",
        t.options, t."createdAt", t."updatedAt",
        COUNT(s.id)::int AS "usageCount",
        ${storeCheckFragment}::int AS "isDefaultForStore"
      FROM "posReceiptTemplates" t
      LEFT JOIN stores s
        ON s."organizationId" = t."organizationId"
       AND s."defaultReceiptTemplateId" = t.id
      WHERE ${where.join(" AND ")}
      GROUP BY t.id
      ORDER BY t."createdAt" DESC
    `;
  } else {
    sql = `
      SELECT
        t.id, t."organizationId", t.name, t.type, t."printFormat",
        t.options, t."createdAt", t."updatedAt"
      FROM "posReceiptTemplates" t
      WHERE ${where.join(" AND ")}
      ORDER BY t."createdAt" DESC
    `;
  }

  try {
    const { rows } = await pool.query(sql, vals);
    return NextResponse.json({ templates: rows }, { status: 200 });
  } catch (e: any) {
    console.error("[GET /pos/receipt-templates]", e);
    return NextResponse.json(
      { error: e?.message ?? "Unable to load receipt templates" },
      { status: 500 }
    );
  }
}

/* ──────────────────────────────────────────────────────────────────────
   POST /api/pos/receipt-templates
────────────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = CreateSchema.parse(await req.json());
    const id = uuidv4();

    const { rows } = await pool.query(
      `INSERT INTO "posReceiptTemplates"
         (id,"organizationId",name,type,"printFormat",options,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       RETURNING *`,
      [id, ctx.organizationId, body.name, "receipt", body.printFormat, body.options ?? {}]
    );

    return NextResponse.json({ template: rows[0] }, { status: 201 });
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors }, { status: 400 });
    }
    console.error("[POST /pos/receipt-templates]", e);
    return NextResponse.json({ error: e?.message ?? "Unable to create" }, { status: 500 });
  }
}
