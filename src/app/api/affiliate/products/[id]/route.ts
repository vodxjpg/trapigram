// ==================================================================
//  src/app/api/affiliate/products/[id]/route.ts  – FULL REWRITE
// ==================================================================
export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import { splitPointsByLevel, mergePointsByLevel } from "@/hooks/affiliatePoints"; // ⬅︎ add
/* ──────────────────────────────────────────────────────────────── */
/*  Shared helpers / Zod                                            */
/* ──────────────────────────────────────────────────────────────── */
const ptsObj = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
const countryMap = z.record(z.string(), ptsObj);          // country ➜ points
const pointsByLvl = z.record(z.string(), countryMap);      // levelId ➜ country map

const stockMap = z.record(z.string(), z.record(z.string(), z.number().min(0)));
const costMap = z.record(z.string(), z.number().min(0));

function splitPoints(map: Record<string, { regular: number; sale: number | null }>) {
  const regular: Record<string, number> = {};
  const sale: Record<string, number> = {};
  for (const [c, v] of Object.entries(map)) {
    regular[c] = v.regular;
    if (v.sale != null) sale[c] = v.sale;
  }
  return { regularPoints: regular, salePoints: Object.keys(sale).length ? sale : null };
}
function mergePoints(
  regular: Record<string, number> | null,
  sale: Record<string, number> | null,
) {
  const out: Record<string, { regular: number; sale: number | null }> = {};
  const reg = regular || {};
  const sal = sale || {};
  for (const [c, v] of Object.entries(reg)) out[c] = { regular: Number(v), sale: null };
  for (const [c, v] of Object.entries(sal))
    out[c] = { ...(out[c] || { regular: 0, sale: null }), sale: Number(v) };
  return out;
}

/* ---------------- schema fragments ----------------------------- */
const variationPatch = z
  .object({
    id: z.string(),
    attributes: z.record(z.string(), z.string()),
    sku: z.string(),
    image: z.string().nullable().optional(),
    pointsPrice: pointsByLvl.optional(),
    prices: pointsByLvl.optional(),
    stock: stockMap.optional(),
    cost: costMap.optional(),
    minLevelId: z.string().uuid().nullable().optional(),
  })
  .transform((v) => ({ ...v, pointsPrice: v.pointsPrice ?? v.prices! }));

const attrInput = z.object({
  id: z.string(),
  selectedTerms: z.array(z.string()),
  useForVariations: z.boolean().optional(), // round‑trip only
});

const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]).optional(),
  productType: z.enum(["simple", "variable"]).optional(),
  allowBackorders: z.boolean().optional(),
  manageStock: z.boolean().optional(),
  pointsPrice: pointsByLvl.optional(),
  cost: costMap.optional(),
  attributes: z.array(attrInput).optional(),
  minLevelId: z.string().uuid().nullable().optional(),
  warehouseStock: z
    .array(
      z.object({
        warehouseId: z.string(),
        affiliateProductId: z.string(),
        variationId: z.string().nullable(), // legacy – ignored on write
        country: z.string(),
        quantity: z.number().min(0),
      }),
    )
    .optional(),
  variations: z.array(variationPatch).optional(),
});

/* =================================================================
   GET  – fetch single affiliate product (incl. variation stock)
   ================================================================= */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const context = await getContext(req);
  if (context instanceof NextResponse) return context;
  const { organizationId } = context;


  /* core row */
  const product = await db
    .selectFrom("affiliateProducts")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();
  if (!product) return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* variations */
  const variations = await db
    .selectFrom("affiliateProductVariations")
    .selectAll()
    .where("productId", "=", product.id)
    .execute();

  /* stock rows (affiliateVariationId FK) */
  const stockRows = await db
    .selectFrom("warehouseStock")
    .select(["warehouseId", "affiliateVariationId", "country", "quantity"])
    .where("affiliateProductId", "=", product.id)
    .execute();

  /* build stock maps */
  const variationStock: Record<string, ReturnType<typeof stockMap.parse>> = {};
  const baseStock: Record<string, Record<string, number>> = {};

  for (const row of stockRows) {
    if (row.affiliateVariationId) {
      const vid = row.affiliateVariationId;
      if (!variationStock[vid]) variationStock[vid] = {};
      if (!variationStock[vid][row.warehouseId]) variationStock[vid][row.warehouseId] = {};
      variationStock[vid][row.warehouseId][row.country] = row.quantity;
    } else {
      if (!baseStock[row.warehouseId]) baseStock[row.warehouseId] = {};
      baseStock[row.warehouseId][row.country] = row.quantity;
    }
  }

  /* attributes with selected terms */
  const attrRows = await db
    .selectFrom("productAttributeValues")
    .innerJoin("productAttributes", "productAttributes.id", "productAttributeValues.attributeId")
    .innerJoin("productAttributeTerms", "productAttributeTerms.id", "productAttributeValues.termId")
    .select([
      "productAttributeValues.attributeId as id",
      "productAttributes.name as name",
      "productAttributeTerms.id  as termId",
      "productAttributeTerms.name as termName",
    ])
    .where("productAttributeValues.productId", "=", product.id)
    .execute();

  const attributes = attrRows.reduce<any[]>((acc, row) => {
    let attr = acc.find((a) => a.id === row.id);
    if (!attr) {
      attr = {
        id: row.id,
        name: row.name,
        selectedTerms: [] as string[],
        terms: [] as { id: string; name: string }[],
      };
      acc.push(attr);
    }
    attr.selectedTerms.push(row.termId);
    attr.terms.push({ id: row.termId, name: row.termName });
    return acc;
  }, []);

  const attributesOut = attributes.map((a) => ({
    ...a,
    useForVariations: product.productType === "variable",
  }));

  const mappedVariations = variations.map(v => {
    // rebuild the full level→country→{regular,sale} map:
    const pointsPrice = mergePointsByLevel(
      v.regularPoints as Record<string, Record<string, number>>,
      v.salePoints as Record<string, Record<string, number>> | null
    );

    return {
      id: v.id,
      attributes: v.attributes,
      sku: v.sku,
      image: v.image,
      // this becomes an object keyed by level IDs
      prices: pointsPrice,
      pointsPrice,
      cost: typeof v.cost === "string" ? JSON.parse(v.cost) : v.cost ?? {},
      minLevelId: v.minLevelId ?? null,
      stock: variationStock[v.id] || {},
    };
  });

  return NextResponse.json({
    product: {
      ...product,
      pointsPrice: mergePointsByLevel(product.regularPoints, product.salePoints),
      cost: typeof product.cost === "string" ? JSON.parse(product.cost) : product.cost ?? {}, // ← NEW
      warehouseStock: stockRows.filter((r) => !r.affiliateVariationId),
      variations: mappedVariations,
      attributes: attributesOut,
    },
  });
}

/* =================================================================
   PATCH – update affiliate product (core, attributes, variations, stock)
   ================================================================= */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id: productId } = await ctx.params;

    const context = await getContext(req);
    if (context instanceof NextResponse) return context;
    const { organizationId, tenantId } = context;

    let body: z.infer<typeof patchSchema>;
    try {
      body = patchSchema.parse(await req.json());
    } catch (err) {
      if (err instanceof z.ZodError)
        return NextResponse.json({ error: err.errors }, { status: 400 });
      throw err;
    }
    if (Object.keys(body).length === 0)
      return NextResponse.json({ message: "Nothing to update" });

    await db.transaction().execute(async (trx) => {
      /* ---------------- core fields ---------------- */
      const core: Record<string, unknown> = {};
      if (body.title !== undefined) core.title = body.title;
      if (body.description !== undefined) core.description = body.description;
      if (body.image !== undefined) core.image = body.image;
      if (body.sku !== undefined) core.sku = body.sku;
      if (body.status !== undefined) core.status = body.status;
      if (body.productType !== undefined) core.productType = body.productType;
      if (body.allowBackorders !== undefined) core.allowBackorders = body.allowBackorders;
      if (body.manageStock !== undefined) core.manageStock = body.manageStock;
      if (body.pointsPrice) {
        const sp = splitPointsByLevel(body.pointsPrice);
        core.regularPoints = sp.regularPoints;
        core.salePoints = sp.salePoints;
      }
      if (body.cost) core.cost = body.cost;
      if (body.minLevelId !== undefined) core.minLevelId = body.minLevelId;
      if (Object.keys(core).length) {
        core.updatedAt = new Date();
        await trx
          .updateTable("affiliateProducts")
          .set(core)
          .where("id", "=", productId)
          .where("organizationId", "=", organizationId)
          .execute();
      }

      /* ---------------- attributes ---------------- */
      if (body.attributes) {
        await trx.deleteFrom("productAttributeValues").where("productId", "=", productId).execute();
        for (const a of body.attributes)
          for (const termId of a.selectedTerms)
            await trx
              .insertInto("productAttributeValues")
              .values({ productId, attributeId: a.id, termId })
              .execute();
      }

      /* ---------------- variations ---------------- */
      if (body.variations) {
        const existingRows = await trx
          .selectFrom("affiliateProductVariations")
          .select("id")
          .where("productId", "=", productId)
          .execute();
        const existingIds = existingRows.map((r) => r.id);

        // delete any removed variations …
        const incomingIds = body.variations.map((v) => v.id);
        const toDelete = existingIds.filter((id) => !incomingIds.includes(id));
        if (toDelete.length) {
          await trx
            .deleteFrom("affiliateProductVariations")
            .where("id", "in", toDelete)
            .execute();
        }

        for (const v of body.variations) {
          // 💡 again use splitPointsByLevel on the nested map:
          const srcMap = v.prices ?? v.pointsPrice;
          const { regularPoints, salePoints } = splitPointsByLevel(srcMap);

          const payload = {
            productId,
            attributes: JSON.stringify(v.attributes),
            sku: v.sku,
            image: v.image ?? null,
            regularPoints,
            salePoints,
            cost: v.cost ?? {},
            minLevelId: v.minLevelId ?? null,
            updatedAt: new Date(),
          };

          if (existingIds.includes(v.id)) {
            await trx
              .updateTable("affiliateProductVariations")
              .set(payload)
              .where("id", "=", v.id)
              .execute();
          } else {
            await trx
              .insertInto("affiliateProductVariations")
              .values({ id: v.id, createdAt: new Date(), ...payload })
              .execute();
          }
        }
      }

      /* ---------------- warehouse stock ---------------- */
      await trx.deleteFrom("warehouseStock").where("affiliateProductId", "=", productId).execute();

      const stockRows: {
        warehouseId: string;
        affiliateProductId: string;
        affiliateVariationId: string | null;
        country: string;
        quantity: number;
      }[] = [];

      /* base‑level rows (if provided) */
      if (body.warehouseStock)
        stockRows.push(
          ...body.warehouseStock.map((r) => ({
            warehouseId: r.warehouseId,
            affiliateProductId: productId,
            affiliateVariationId: r.variationId, // may be null
            country: r.country,
            quantity: r.quantity,
          })),
        );

      /* collect per‑variation stock from body.variations */
      if (body.variations)
        for (const v of body.variations) {
          if (!v.stock) continue;
          for (const [wId, byCountry] of Object.entries(v.stock))
            for (const [country, qty] of Object.entries(byCountry))
              if (qty > 0)
                stockRows.push({
                  warehouseId: wId,
                  affiliateProductId: productId,
                  affiliateVariationId: v.id,
                  country,
                  quantity: qty,
                });
        }

      /* insert */
      for (const r of stockRows) {
        await trx
          .insertInto("warehouseStock")
          .values({
            id: uuidv4(),
            warehouseId: r.warehouseId,
            affiliateProductId: productId,
            variationId: null,
            affiliateVariationId: r.affiliateVariationId,
            country: r.country,
            quantity: r.quantity,
            organizationId,
            tenantId,               /* FIX */
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }

      /* stockStatus */
      await trx
        .updateTable("affiliateProducts")
        .set({
          stockStatus: stockRows.length && (body.manageStock ?? true) ? "managed" : "unmanaged",
          updatedAt: new Date(),
        })
        .where("id", "=", productId)
        .execute();
    });

    return NextResponse.json({ id: productId, updated: true });
  } catch (err) {
    console.error("[AFFILIATE_PRODUCTS_PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
/* ══════════════════════════════════════════════════════════════
   DELETE – remove product  children
   ════════════════════════════════════════════════════════════ */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = params;

  /* child rows cascade thanks to FK ON DELETE CASCADE, but we
     delete variations manually to clear their stocks first      */
  await db
    .deleteFrom("warehouseStock")
    .where("affiliateProductId", "=", id)
    .execute();

  await db
    .deleteFrom("affiliateProductVariations")
    .where("productId", "=", id)
    .execute();

  await db
    .deleteFrom("affiliateProducts")
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .execute();

  return NextResponse.json({ id, deleted: true });
}
