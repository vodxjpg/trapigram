import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

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
    showCashier: z.boolean().default(true),         // employee name on receipt
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

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { organizationId } = ctx;
  const { rows } = await pool.query(
    `SELECT * FROM "posReceiptTemplates"
      WHERE "organizationId" = $1
      ORDER BY "createdAt" DESC`,
    [organizationId]
  );
  return NextResponse.json({ templates: rows }, { status: 200 });
}

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
    if (e instanceof z.ZodError)
      return NextResponse.json({ error: e.errors }, { status: 400 });
    return NextResponse.json({ error: e?.message ?? "Unable to create" }, { status: 500 });
  }
}
