// /home/zodx/Desktop/trapigram/src/app/api/tier-pricing/route.ts
// src/app/api/tier-pricing/route.ts
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context"
import { v4 as uuidv4 } from "uuid"

/* ─── schemas ─────────────────────────── */
const stepSchema = z.object({
  fromUnits: z.number().min(1),
  toUnits: z.number().min(1),
  price: z.number().positive(),
})

/**
 * IMPORTANT: shared product copies use non-UUID string IDs like "PROD-xxxx" / "VAR-xxxx".
 * We must NOT enforce UUID shape here, only non-empty strings (or null).
 */
const productItemSchema = z
  .object({
    productId: z.string().min(1).nullable(),
    variationId: z.string().min(1).nullable(),
  })
  .refine(d => d.productId || d.variationId, { message: "Must specify productId or variationId" })

const bodySchema = z.object({
  name: z.string().min(1),
  countries: z.array(z.string().length(2)).min(1),
  products: z.array(productItemSchema).min(1),
  steps: z.array(stepSchema).min(1),
})

/* ─── GET list ────────────────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req)
  if (ctx instanceof NextResponse) return ctx
  const { organizationId } = ctx

  const rows = await db
    .selectFrom("tierPricings")
    .selectAll()
    .where("organizationId", "=", organizationId)
    .execute()

  const tierPricings = await Promise.all(
    rows.map(async r => {
      const countries = typeof r.countries === "string" ? JSON.parse(r.countries || "[]") : r.countries

      const products = await db
        .selectFrom("tierPricingProducts")
        .select(["productId", "variationId"])
        .where("tierPricingId", "=", r.id)
        .execute()

      const steps = await db
        .selectFrom("tierPricingSteps")
        .select(["fromUnits", "toUnits", "price"])
        .where("tierPricingId", "=", r.id)
        .execute()

      return { ...r, countries, products, steps }
    }),
  )

  return NextResponse.json({ tierPricings })
}

/* ─── POST create ─────────────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req)
  if (ctx instanceof NextResponse) return ctx
  const { organizationId } = ctx

  const body = bodySchema.parse(await req.json())
  const pricingId = uuidv4()
  const now = new Date()

  await db
    .insertInto("tierPricings")
    .values({
      id: pricingId,
      organizationId,
      active: true,
      name: body.name,
      countries: JSON.stringify(body.countries),
      createdAt: now,
      updatedAt: now,
    })
    .execute()

  for (const s of body.steps)
    await db
      .insertInto("tierPricingSteps")
      .values({
        id: uuidv4(),
        tierPricingId: pricingId,
        fromUnits: s.fromUnits,
        toUnits: s.toUnits,
        price: s.price,
        createdAt: now,
        updatedAt: now,
      })
      .execute()

  for (const p of body.products)
    await db
      .insertInto("tierPricingProducts")
      .values({
        id: uuidv4(),
        tierPricingId: pricingId,
        productId: p.productId,
        variationId: p.variationId,
        createdAt: now,
      })
      .execute()

  return NextResponse.json({ success: true, pricingId }, { status: 201 })
}
