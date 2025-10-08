// src/app/api/products/[id]/duplicate
import { type NextRequest, NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
async function uniqueSku(base: string, organizationId: string): Promise<string> {
  let candidate = `${base}-COPY`
  let counter = 1
  while (
    await db
      .selectFrom("products")
      .select("id")
      .where("sku", "=", candidate)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()
  ) {
    candidate = `${base}-COPY-${counter++}`
  }
  return candidate
}

async function uniqueVariationSku(base: string, organizationId: string): Promise<string> {
  let candidate = `${base}-COPY`
  let counter = 1
  while (
    await db
      .selectFrom("productVariations")
      .select("id")
      .where("sku", "=", candidate)
      .executeTakeFirst()
  ) {
    candidate = `${base}-COPY-${counter++}`
  }
  return candidate
}

/* ------------------------------------------------------------------ */
/* POST – duplicate                                                   */
/* ------------------------------------------------------------------ */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  try {
    const { id: sourceProductId } = await params

    /* ---------- source product --------------------------------- */
    const source = await db
      .selectFrom("products")
      .selectAll()
      .where("id", "=", sourceProductId)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()

    if (!source) return NextResponse.json({ error: "Product not found" }, { status: 404 })

    /* ---------- tenant for new product ------------------------- */
    const tenantId = source.tenantId

    /* ---------- new product basics ----------------------------- */
    const newProductId = uuidv4()
    const newSku = await uniqueSku(source.sku, organizationId)
    const newTitle = `${source.title} - COPY`

    /* ---------- insert product --------------------------------- */
    await db
      .insertInto("products")
      .values({
        ...source,
        id: newProductId,
        sku: newSku,
        title: newTitle,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute()

    /* ---------- categories ------------------------------------- */
    const categories = await db
      .selectFrom("productCategory")
      .select("categoryId")
      .where("productId", "=", sourceProductId)
      .execute()
    for (const c of categories)
      await db.insertInto("productCategory").values({ productId: newProductId, categoryId: c.categoryId }).execute()

    /* ---------- attributes ------------------------------------- */
    const attrs = await db
      .selectFrom("productAttributeValues")
      .select(["attributeId", "termId"])
      .where("productId", "=", sourceProductId)
      .execute()
    for (const a of attrs)
      await db
        .insertInto("productAttributeValues")
        .values({ productId: newProductId, attributeId: a.attributeId, termId: a.termId })
        .execute()

    /* ---------- variations (if any) ---------------------------- */
    const variationRows =
      source.productType === "variable"
        ? await db.selectFrom("productVariations").selectAll().where("productId", "=", sourceProductId).execute()
        : []

    const variationIdMap: Record<string, string> = {}

    for (const v of variationRows) {
      const newVarId = uuidv4()
      variationIdMap[v.id] = newVarId
      const newVarSku = await uniqueVariationSku(v.sku, organizationId)

      await db
        .insertInto("productVariations")
        .values({
          ...v,
          id: newVarId,
          productId: newProductId,
          sku: newVarSku,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute()
    }

    /* ---------- stock ------------------------------------------ */
    const stockRows = await db
      .selectFrom("warehouseStock")
      .selectAll()
      .where("productId", "=", sourceProductId)
      .execute()

    for (const s of stockRows) {
      await db
        .insertInto("warehouseStock")
        .values({
          ...s,
          id: uuidv4(),
          productId: newProductId,
          variationId: s.variationId ? variationIdMap[s.variationId] : null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute()
    }

    return NextResponse.json({ productId: newProductId }, { status: 201 })
  } catch (err) {
    console.error("[PRODUCT_DUPLICATE]", err)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
