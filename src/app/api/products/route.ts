import { type NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { db } from "@/lib/db"
import { auth } from "@/lib/auth"
import { v4 as uuidv4 } from "uuid"

/* ------------------------------------------------------------------ */
/*  ZOD ‑ schema                                                      */
/* ------------------------------------------------------------------ */
const priceObj = z.object({
  regular: z.number().min(0),
  sale:    z.number().nullable(),
})

const costMap = z.record(z.string(), z.number().min(0))

const warehouseStockSchema = z.array(z.object({
  warehouseId: z.string(),
  productId: z.string(),
  variationId: z.string().nullable(),
  country: z.string(),
  quantity: z.number().min(0),
}))

const variationSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.string()),
  sku: z.string(),
  image: z.string().nullable().optional(),
  prices: z.record(z.string(), priceObj),
  cost:   costMap.optional(), 
})

const productSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1).optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  prices: z.record(z.string(), priceObj),
  cost:   costMap.optional(), 
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
  warehouseStock: warehouseStockSchema.optional(),
  attributes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      terms: z.array(z.object({ id: z.string(), name: z.string() })),
      useForVariations: z.boolean(),
      selectedTerms: z.array(z.string()),
    }),
  ).optional(),
  variations: z.array(variationSchema).optional(),
})

/* helper: convert { ES: {regular:19, sale:10}, … } --> two JSON objects */
function splitPrices(pr: Record<string, { regular: number; sale: number | null }>) {
  const regular: Record<string, number> = {}
  const sale: Record<string, number> = {}
  for (const [c, v] of Object.entries(pr)) {
    regular[c] = v.regular
    if (v.sale != null) sale[c] = v.sale
  }
  return { regularPrice: regular, salePrice: Object.keys(sale).length ? sale : null }
}

/* ------------------------------------------------------------------ */
/*  GET                                                               */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers })
    if (!session) return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 })
    const organizationId = session.session.activeOrganizationId
    const userId = session.user.id
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const page     = parseInt(searchParams.get("page")     || "1")
    const pageSize = parseInt(searchParams.get("pageSize") || "10")
    const search   = searchParams.get("search")     || ""
    const categoryId = searchParams.get("categoryId") || ""

    const tenant = await db
      .selectFrom("tenant")
      .select(["id"])
      .where("ownerUserId", "=", userId)
      .executeTakeFirst()
    if (!tenant) return NextResponse.json({ error: "No tenant found for user" }, { status: 404 })
    const tenantId = tenant.id

    let productsQuery = db
      .selectFrom("products")
      .select([
        "products.id", "title", "description", "image", "sku", "status", "productType",
        "regularPrice", "salePrice", "cost",
        "allowBackorders", "manageStock", "stockStatus",
        "products.createdAt", "products.updatedAt",
      ])
      .leftJoin("warehouseStock", "warehouseStock.productId", "products.id")
      .where("products.organizationId", "=", organizationId) // Explicitly qualify organizationId
      .where("products.tenantId", "=", tenantId)

    if (search) productsQuery = productsQuery.where("title", "ilike", `%${search}%`)
    if (categoryId) productsQuery = productsQuery
      .innerJoin("productCategory", "productCategory.productId", "products.id")
      .where("productCategory.categoryId", "=", categoryId)

    const productRows = await productsQuery
      .select([
        "warehouseStock.warehouseId",
        "warehouseStock.country",
        "warehouseStock.quantity",
        "warehouseStock.variationId",
      ])
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute()

    const productIds = [...new Set(productRows.map(p => p.id))]

    const variations = productIds.length
      ? await db
          .selectFrom("productVariations")
          .selectAll()
          .where("productId", "in", productIds)
          .execute()
      : []

    const productCategories = productIds.length
      ? await db
          .selectFrom("productCategory")
          .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
          .select(["productCategory.productId", "productCategories.name"])
          .where("productCategory.productId", "in", productIds)
          .execute()
      : []

    const productsMap = new Map<string, any>()
    for (const row of productRows) {
      if (!productsMap.has(row.id)) {
        productsMap.set(row.id, {
          id: row.id,
          title: row.title,
          description: row.description,
          image: row.image,
          sku: row.sku,
          status: row.status,
          productType: row.productType,
          regularPrice: typeof row.regularPrice === "string" ? JSON.parse(row.regularPrice) : row.regularPrice,
          salePrice: typeof row.salePrice === "string" ? JSON.parse(row.salePrice) : row.salePrice,
          cost: typeof row.cost === "string" ? JSON.parse(row.cost) : row.cost,
          allowBackorders: row.allowBackorders,
          manageStock: row.manageStock,
          stockStatus: row.stockStatus,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          stockData: {},
          categories: productCategories.filter(pc => pc.productId === row.id).map(pc => pc.name),
        })
      }
      if (row.warehouseId && !row.variationId) {
        const stockData = productsMap.get(row.id).stockData
        if (!stockData[row.warehouseId]) stockData[row.warehouseId] = {}
        stockData[row.warehouseId][row.country] = row.quantity
      }
    }

    const products = Array.from(productsMap.values()).map(p => ({
      ...p,
      variations: variations
        .filter(v => v.productId === p.id)
        .map(v => ({
          id: v.id,
          attributes: typeof v.attributes === "string" ? JSON.parse(v.attributes) : v.attributes,
          sku: v.sku,
          image: v.image,
          prices: mergePriceMaps(
            typeof v.regularPrice === "string" ? JSON.parse(v.regularPrice) : v.regularPrice,
            typeof v.salePrice === "string" ? JSON.parse(v.salePrice) : v.salePrice
          ),
          cost: typeof v.cost === "string" ? JSON.parse(v.cost) : v.cost,
          stock: productRows
            .filter(r => r.variationId === v.id && r.warehouseId)
            .reduce((acc, r) => {
              if (!acc[r.warehouseId!]) acc[r.warehouseId!] = {}
              acc[r.warehouseId!][r.country] = r.quantity
              return acc
            }, {} as Record<string, Record<string, number>>)
        }))
    }))

    const totalRes = await db
      .selectFrom("products")
      .select(db.fn.count("id").as("total"))
      .where("organizationId", "=", organizationId)
      .where("tenantId", "=", tenantId)
      .$if(search, q => q.where("title", "ilike", `%${search}%`))
      .$if(categoryId, q => q
        .innerJoin("productCategory", "productCategory.productId", "products.id")
        .where("productCategory.categoryId", "=", categoryId))
      .executeTakeFirst()
    const total = Number(totalRes?.total || 0)

    return NextResponse.json({
      products,
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    })
  } catch (err) {
    console.error("[PRODUCTS_GET]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/* helper: merge regular/sale JSON objects ➜ { IT:{regular, sale}, …} */
function mergePriceMaps(
  regular: Record<string, number> | null,
  sale: Record<string, number> | null,
) {
  const map: Record<string, { regular: number; sale: number | null }> = {}
  const reg = regular || {}
  const sal = sale || {}
  for (const [c, v] of Object.entries(reg)) map[c] = { regular: Number(v), sale: null }
  for (const [c, v] of Object.entries(sal))
    map[c] = { ...(map[c] || { regular: 0, sale: null }), sale: Number(v) }
  return map
}

/* ------------------------------------------------------------------ */
/*  POST                                                              */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key")
  const internalSecret = req.headers.get("x-internal-secret")
  let organizationId!: string
  let userId!: string

  /* ----------  auth boilerplate  --------------------------------- */
  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } })
    if (!valid || !key) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 })
    const session = await auth.api.getSession({ headers: req.headers })
    organizationId = session?.session.activeOrganizationId || ""
    userId = session?.user?.id || ""
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 })
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const s = await auth.api.getSession({ headers: req.headers })
    if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 })
    organizationId = s.session.activeOrganizationId
    userId = s.user.id
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 })
  } else {
    const s = await auth.api.getSession({ headers: req.headers })
    if (!s) return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 })
    organizationId = s.session.activeOrganizationId
    userId = s.user.id
    if (!organizationId) return NextResponse.json({ error: "No active organization in session" }, { status: 400 })
  }

  /* ----------  main logic  --------------------------------------- */
  try {
    const body = await req.json()
    let parsedProduct = productSchema.parse(body)

    const tenant = await db.selectFrom("tenant").select("id").where("ownerUserId", "=", userId).executeTakeFirst()
    if (!tenant) return NextResponse.json({ error: "No tenant found for user" }, { status: 404 })
    const tenantId = tenant.id

    /* SKU handling */
    let finalSku = parsedProduct.sku
    if (!finalSku) {
      do {
        finalSku = `SKU-${uuidv4().slice(0, 8)}`
      } while (await db.selectFrom("products").select("id")
        .where("sku", "=", finalSku)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst())
    } else {
      const exists = await db.selectFrom("products").select("id")
        .where("sku", "=", finalSku)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst()
      if (exists) return NextResponse.json({ error: "SKU already exists" }, { status: 400 })
    }
    parsedProduct = { ...parsedProduct, sku: finalSku }

    /* category validation */
    if (parsedProduct.categories?.length) {
      const validIds = (await db.selectFrom("productCategories")
        .select("id")
        .where("organizationId", "=", organizationId)
        .execute()).map(c => c.id)
      const bad = parsedProduct.categories.filter(id => !validIds.includes(id))
      if (bad.length)
        return NextResponse.json({ error: `Invalid category IDs: ${bad.join(", ")}` }, { status: 400 })
    }

    /* split prices into two JSON objects */
    const { regularPrice, salePrice } = splitPrices(parsedProduct.prices)

    const productId = uuidv4()

    await db.insertInto("products").values({
      id: productId,
      organizationId,
      tenantId,
      title: parsedProduct.title,
      description: parsedProduct.description || null,
      image: parsedProduct.image || null,
      sku: parsedProduct.sku,
      status: parsedProduct.status,
      productType: parsedProduct.productType,
      regularPrice,
      salePrice,
      cost: parsedProduct.cost ?? {},
      allowBackorders: parsedProduct.allowBackorders,
      manageStock: parsedProduct.manageStock,
      stockStatus: parsedProduct.manageStock ? "managed" : "unmanaged",
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute()

    /* variations */
    if (parsedProduct.productType === "variable" && parsedProduct.variations?.length) {
      for (const v of parsedProduct.variations) {
        const { regularPrice, salePrice } = splitPrices(v.prices)
        await db.insertInto("productVariations").values({
          id: v.id,
          productId,
          attributes: JSON.stringify(v.attributes),
          sku: v.sku,
          image: v.image ?? null,
          regularPrice,
          salePrice,
          cost: v.cost ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }).execute()
      }
    }

    /* insert warehouseStock entries */
    if (parsedProduct.warehouseStock?.length) {
      for (const entry of parsedProduct.warehouseStock) {
        await db.insertInto("warehouseStock").values({
          id: uuidv4(),
          warehouseId: entry.warehouseId,
          productId: entry.productId,
          variationId: entry.variationId,
          country: entry.country,
          quantity: entry.quantity,
          organizationId,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).execute()
      }
    }

    /* attribute & category relations */
    if (parsedProduct.attributes?.length) {
      for (const a of parsedProduct.attributes)
        for (const termId of a.selectedTerms)
          await db.insertInto("productAttributeValues")
            .values({ productId, attributeId: a.id, termId })
            .execute()
    }
    if (parsedProduct.categories?.length) {
      for (const cid of parsedProduct.categories)
        await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
    }

    return NextResponse.json({
      product: {
        id: productId, ...parsedProduct, cost: parsedProduct.cost ?? {}, organizationId, tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }, { status: 201 })
  } catch (err) {
    console.error("[PRODUCTS_POST]", err)
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}