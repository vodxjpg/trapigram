// src/app/api/tier-pricing/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context"
import { v4 as uuidv4 } from "uuid"

const paramsSchema = z.object({ id: z.string().uuid() })
const stepSchema = z.object({ fromUnits: z.number().min(1), toUnits: z.number().min(1), price: z.number().positive() })
const productItemSchema = z
  .object({ productId: z.string().uuid().nullable(), variationId: z.string().uuid().nullable() })
  .refine(d => d.productId || d.variationId, { message: "Must specify productId or variationId" })
const patchSchema = z.object({
  name: z.string().min(1).optional(),
  countries: z.array(z.string().length(2)).min(1).optional(),
  products: z.array(productItemSchema).min(1).optional(),
  steps: z.array(stepSchema).min(1).optional(),
  active: z.boolean().optional(),
})

/* ─── GET single ──────────────────────── */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req)
  if (ctx instanceof NextResponse) return ctx
  const { organizationId } = ctx
  const { id } = paramsSchema.parse(await params)

  const row = await db
    .selectFrom("tierPricings")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst()
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const countries = typeof row.countries === "string" ? JSON.parse(row.countries || "[]") : row.countries

  const products = await db
    .selectFrom("tierPricingProducts")
    .select(["productId", "variationId"])
    .where("tierPricingId", "=", id)
    .execute()

  const steps = await db
    .selectFrom("tierPricingSteps")
    .select(["fromUnits", "toUnits", "price"])
    .where("tierPricingId", "=", id)
    .execute()

  return NextResponse.json({ ...row, countries, products, steps })
}

/* ─── PATCH update ────────────────────── */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req)
  if (ctx instanceof NextResponse) return ctx
  const { organizationId } = ctx
  const { id } = paramsSchema.parse(await params)
  const body = patchSchema.parse(await req.json())
  const now = new Date()

  const updateCols: any = { updatedAt: now }
  if (body.name) updateCols.name = body.name
  if (body.countries) updateCols.countries = JSON.stringify(body.countries)
  if (typeof body.active === "boolean") updateCols.active = body.active;

  await db.updateTable("tierPricings").set(updateCols).where("id", "=", id).execute()

  if (body.steps) {
    await db.deleteFrom("tierPricingSteps").where("tierPricingId", "=", id).execute()
    for (const s of body.steps)
      await db
        .insertInto("tierPricingSteps")
        .values({
          id: uuidv4(),
          tierPricingId: id,
          fromUnits: s.fromUnits,
          toUnits: s.toUnits,
          price: s.price,
          createdAt: now,
          updatedAt: now,
        })
        .execute()
  }

  if (body.products) {
    await db.deleteFrom("tierPricingProducts").where("tierPricingId", "=", id).execute()
    for (const p of body.products)
      await db
        .insertInto("tierPricingProducts")
        .values({
          id: uuidv4(),
          tierPricingId: id,
          productId: p.productId,
          variationId: p.variationId,
          createdAt: now,
        })
        .execute()
  }

  return NextResponse.json({ success: true })
}

/* ─── DELETE (unchanged logic, table names updated) ───────────── */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = paramsSchema.parse(await params)

  await db.deleteFrom("tierPricingProducts").where("tierPricingId", "=", id).execute()
  await db.deleteFrom("tierPricingSteps").where("tierPricingId", "=", id).execute()
  await db.deleteFrom("tierPricings").where("id", "=", id).execute()

  return NextResponse.json({ success: true })
}
