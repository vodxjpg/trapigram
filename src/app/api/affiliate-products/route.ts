// /home/zodx/Desktop/trapigram/src/app/api/affiliate-products/route.ts
import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"
import { v4 as uuidv4 } from "uuid"

/* ────────────────────────────────────────────────────────────── */
/* shared zod schemas                                             */
/* ────────────────────────────────────────────────────────────── */
const pointsMap = z.record(z.string(), z.number().min(0))

const variationSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.string()),
  sku: z.string().min(1),
  image: z.string().nullable().optional(),
  pointsPrice: pointsMap,
})

const affiliateProductSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
  pointsPrice: pointsMap, // simple products
  variations: z.array(variationSchema).optional(), // variable
})

/* helper – generate unique SKU inside org */
async function uniqueSku(base: string, orgId: string) {
  let candidate = base
  while (
    await db
      .selectFrom("products")
      .select("id")
      .where("sku", "=", candidate)
      .where("organizationId", "=", orgId)
      .executeTakeFirst()
  ) {
    candidate = `SKU-${uuidv4().slice(0, 8)}`
  }
  return candidate
}

/* ────────────────────────────────────────────────────────────── */
/* GET – list affiliate products                                  */
/* ────────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  try {
    /* auth */
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const organizationId = session.session.activeOrganizationId
    if (!organizationId)
      return NextResponse.json({ error: "No active organization" }, { status: 400 })
    const userId = session.user.id

    /* tenant */
    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", userId)
      .executeTakeFirst()
    if (!tenant)
      return NextResponse.json({ error: "No tenant for user" }, { status: 404 })
    const tenantId = tenant.id

    /* query params */
    const { searchParams } = new URL(req.url)
    const limit  = parseInt(searchParams.get("limit") || "50")
    const offset = parseInt(searchParams.get("offset") || "0")
    const search = searchParams.get("search") || ""

    /* query */
    const rows = await db
      .selectFrom("products as p")
      .innerJoin("affiliateProducts as ap", "ap.productId", "p.id")
      .select([
        "p.id",
        "p.title",
        "p.image",
        "p.sku",
        "p.status",
        "p.productType",
        "ap.pointsPrice",
        "p.createdAt",
      ])
      .where("p.organizationId", "=", organizationId)
      .where("p.tenantId", "=", tenantId)
      .$if(search, (qb) => qb.where("p.title", "ilike", `%${search}%`))
      .limit(limit)
      .offset(offset)
      .execute()

    const products = rows.map((r) => ({
      id: r.id,
      title: r.title,
      image: r.image,
      sku: r.sku,
      status: r.status,
      productType: r.productType,
      pointsPrice:
        typeof r.pointsPrice === "string" ? JSON.parse(r.pointsPrice) : r.pointsPrice,
      createdAt: r.createdAt,
    }))

    return NextResponse.json({ products })
  } catch (err) {
    console.error("[AFFILIATE_PRODUCTS_GET]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/* ────────────────────────────────────────────────────────────── */
/* POST – create affiliate product                                */
/* ────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  /* 🔒 auth */
  const session = await auth.api.getSession({ headers: req.headers })
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const organizationId = session.session.activeOrganizationId
  if (!organizationId)
    return NextResponse.json({ error: "No active organization" }, { status: 400 })
  const userId = session.user.id

  /* tenant id for user */
  const tenantRow = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", userId)
    .executeTakeFirst()
  if (!tenantRow)
    return NextResponse.json({ error: "No tenant for user" }, { status: 404 })
  const tenantId = tenantRow.id

  /* validate input */
  let body
  try {
    body = affiliateProductSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 })
    throw err
  }

  /* SKU */
  const finalSku = await uniqueSku(
    body.sku || `SKU-${uuidv4().slice(0, 8)}`,
    organizationId,
  )

  /* insert product */
  const productId = uuidv4()
  await db
    .insertInto("products")
    .values({
      id: productId,
      organizationId,
      tenantId,
      title: body.title,
      description: body.description || null,
      image: body.image || null,
      sku: finalSku,
      status: body.status,
      productType: body.productType,
      regularPrice: {},
      salePrice: null,
      cost: {},
      allowBackorders: body.allowBackorders,
      manageStock: body.manageStock,
      stockStatus: "unmanaged",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute()

  /* points map for simple */
  await db
    .insertInto("affiliateProducts")
    .values({
      productId,
      pointsPrice: body.pointsPrice,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute()

  /* variations */
  if (body.productType === "variable" && body.variations?.length) {
    for (const v of body.variations) {
      await db
        .insertInto("productVariations")
        .values({
          id: v.id,
          productId,
          attributes: JSON.stringify(v.attributes),
          sku: v.sku,
          image: v.image ?? null,
          regularPrice: {},
          salePrice: null,
          cost: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute()

      await db
        .insertInto("affiliateVariationPoints")
        .values({
          variationId: v.id,
          pointsPrice: v.pointsPrice,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute()
    }
  }

  return NextResponse.json(
    { productId, sku: finalSku, createdAt: new Date().toISOString() },
    { status: 201 },
  )
}
