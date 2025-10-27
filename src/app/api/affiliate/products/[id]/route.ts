// ==================================================================
//  src/app/api/affiliate/products/[id]/route.ts
// ==================================================================
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { splitPointsByLevel, mergePointsByLevel } from "@/hooks/affiliatePoints";

/* Safe JSON parser: accepts object, stringified JSON, null/undefined */
function jsonMaybe<T>(val: unknown): T | null {
  if (val == null) return null;
  if (typeof val === "string") {
    try {
      return JSON.parse(val) as T;
    } catch {
      return null;
    }
  }
  return val as T;
}

/* Type for points map used in merge */
type PointsByLvl = Record<string, Record<string, { regular: number; sale: number | null }>>;

/* Deep merge helper: base ⊕ delta (delta wins per level/country/field) */
function deepMergePoints(base: PointsByLvl, delta: PointsByLvl): PointsByLvl {
  const out: PointsByLvl = JSON.parse(JSON.stringify(base || {}));
  for (const [lvl, countries] of Object.entries(delta || {})) {
    out[lvl] ??= {};
    for (const [cc, pts] of Object.entries(countries || {})) {
      const prev = out[lvl][cc] ?? { regular: 0, sale: null };
      out[lvl][cc] = {
        regular: typeof pts?.regular === "number" ? pts.regular : prev.regular,
        sale: pts?.sale === null || typeof pts?.sale === "number" ? pts.sale : prev.sale,
      };
    }
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────── */
/*  Shared helpers / Zod                                            */
/* ──────────────────────────────────────────────────────────────── */
const ptsObj = z.object({
  regular: z.number().min(0),
  sale: z.number().nullable(),
});
const countryMap = z.record(z.string(), ptsObj); // country ➜ points
const pointsByLvl = z.record(z.string(), countryMap); // levelId ➜ country map

const stockMap = z.record(z.string(), z.record(z.string(), z.number().min(0)));
const costMap = z.record(z.string(), z.number().min(0));

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
  useForVariations: z.boolean().optional(), // round-trip only
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
   GET  – fetch single affiliate product (incl. variation stock)
   ================================================================= */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // core row
  const product = await db
    .selectFrom("affiliateProducts")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();

  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // variations
  const variations = await db
    .selectFrom("affiliateProductVariations")
    .selectAll()
    .where("productId", "=", product.id)
    .execute();

  // stock rows (affiliateVariationId FK)
  const stockRows = await db
    .selectFrom("warehouseStock")
    .select(["warehouseId", "affiliateVariationId", "country", "quantity"])
    .where("affiliateProductId", "=", product.id)
    .execute();

  // build variation-level stock maps
  const variationStock: Record<string, ReturnType<typeof stockMap.parse>> = {};
  for (const row of stockRows) {
    if (!row.affiliateVariationId) continue;
    const vid = row.affiliateVariationId;
    if (!variationStock[vid]) variationStock[vid] = {};
    if (!variationStock[vid][row.warehouseId]) variationStock[vid][row.warehouseId] = {};
    variationStock[vid][row.warehouseId][row.country] = row.quantity;
  }

  // attributes with selected terms
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

  const mappedVariations = variations.map((v) => {
    const vRegular = jsonMaybe<Record<string, Record<string, number>>>(v.regularPoints) ?? {};
    const vSale = jsonMaybe<Record<string, Record<string, number>> | null>(v.salePoints);
    const vCost = jsonMaybe<Record<string, number>>(v.cost) ?? {};
    const vAttrs =
      typeof v.attributes === "string"
        ? jsonMaybe<Record<string, string>>(v.attributes) ?? {}
        : (v.attributes as any);

    const pointsPrice = mergePointsByLevel(vRegular, vSale);

    return {
      id: v.id,
      attributes: vAttrs,
      sku: v.sku,
      image: v.image,
      prices: pointsPrice,
      pointsPrice,
      cost: vCost,
      minLevelId: v.minLevelId ?? null,
      stock: variationStock[v.id] || {},
    };
  });

  const pRegular = jsonMaybe<Record<string, Record<string, number>>>(product.regularPoints) ?? {};
  const pSale = jsonMaybe<Record<string, Record<string, number>> | null>(product.salePoints);
  const pCost = jsonMaybe<Record<string, number>>(product.cost) ?? {};

  return NextResponse.json({
    product: {
      ...product,
      pointsPrice: mergePointsByLevel(pRegular, pSale),
      cost: pCost,
      warehouseStock: stockRows.filter((r) => !r.affiliateVariationId),
      variations: mappedVariations,
      attributes: attributesOut,
    },
  });
}

/* =================================================================
   PATCH – update affiliate product (core, attributes, variations, stock)
   ================================================================= */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id: productId } = await context.params;

    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId, tenantId } = ctx;

    let body: z.infer<typeof patchSchema>;
    try {
      body = patchSchema.parse(await req.json());
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: err.errors }, { status: 400 });
      }
      throw err;
    }

    if (Object.keys(body).length === 0) {
      return NextResponse.json({ message: "Nothing to update" });
    }

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

      // === Deep-merge points =====
      if (body.pointsPrice) {
        // get existing product points
        const existing = await trx
          .selectFrom("affiliateProducts")
          .select(["regularPoints", "salePoints"])
          .where("id", "=", productId)
          .executeTakeFirst();

        const existingRegular =
          jsonMaybe<Record<string, Record<string, number>>>(existing?.regularPoints) ?? {};
        const existingSale =
          jsonMaybe<Record<string, Record<string, number>> | null>(existing?.salePoints);

        const currentPoints = mergePointsByLevel(existingRegular, existingSale);
        const mergedPoints = deepMergePoints(currentPoints, body.pointsPrice as PointsByLvl);
        const sp = splitPointsByLevel(mergedPoints);

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
        await trx
          .deleteFrom("productAttributeValues")
          .where("productId", "=", productId)
          .execute();

        for (const a of body.attributes) {
          for (const termId of a.selectedTerms) {
            await trx
              .insertInto("productAttributeValues")
              .values({ productId, attributeId: a.id, termId })
              .execute();
          }
        }
      }

      /* ---------------- variations ---------------- */
      if (body.variations) {
        const existingRows = await trx
          .selectFrom("affiliateProductVariations")
          .select(["id", "regularPoints", "salePoints"])
          .where("productId", "=", productId)
          .execute();
        const existingById = new Map(
          existingRows.map((r) => [
            r.id,
            {
              regular:
                jsonMaybe<Record<string, Record<string, number>>>(r.regularPoints) ?? {},
              sale:
                jsonMaybe<Record<string, Record<string, number>> | null>(r.salePoints),
            },
          ]),
        );
        const existingIds = existingRows.map((r) => r.id);

        // delete removed variations
        const incomingIds = body.variations.map((v) => v.id);
        const toDelete = existingIds.filter((id) => !incomingIds.includes(id));
        if (toDelete.length) {
          await trx
            .deleteFrom("affiliateProductVariations")
            .where("id", "in", toDelete)
            .execute();
        }

        for (const v of body.variations) {
          const incomingSrc = v.prices ?? v.pointsPrice;

          // merge (if incoming points provided); otherwise keep existing untouched
          let mergedForVar: PointsByLvl | null = null;
          if (incomingSrc) {
            const prev = existingById.get(v.id);
            const prevMerged = mergePointsByLevel(prev?.regular ?? {}, prev?.sale ?? null);
            mergedForVar = deepMergePoints(prevMerged, incomingSrc as PointsByLvl);
          }

          const payload: Record<string, unknown> = {
            productId,
            attributes: JSON.stringify(v.attributes),
            sku: v.sku,
            image: v.image ?? null,
            cost: v.cost ?? {},
            minLevelId: v.minLevelId ?? null,
            updatedAt: new Date(),
          };

          if (mergedForVar) {
            const sp = splitPointsByLevel(mergedForVar);
            payload.regularPoints = sp.regularPoints;
            payload.salePoints = sp.salePoints;
          }

          if (existingById.has(v.id)) {
            await trx
              .updateTable("affiliateProductVariations")
              .set(payload)
              .where("id", "=", v.id)
              .execute();
          } else {
            // creating new variation: we still need points (if not provided, start empty)
            if (!mergedForVar) {
              mergedForVar = deepMergePoints({}, (incomingSrc || {}) as PointsByLvl);
              const sp = splitPointsByLevel(mergedForVar);
              payload.regularPoints = sp.regularPoints;
              payload.salePoints = sp.salePoints;
            }
            await trx
              .insertInto("affiliateProductVariations")
              .values({ id: v.id, createdAt: new Date(), ...payload })
              .execute();
          }
        }
      }

      /* ---------------- warehouse stock ---------------- */
      await trx
        .deleteFrom("warehouseStock")
        .where("affiliateProductId", "=", productId)
        .execute();

      const stockRows: {
        warehouseId: string;
        affiliateProductId: string;
        affiliateVariationId: string | null;
        country: string;
        quantity: number;
      }[] = [];

      // base-level rows (if provided)
      if (body.warehouseStock) {
        stockRows.push(
          ...body.warehouseStock.map((r) => ({
            warehouseId: r.warehouseId,
            affiliateProductId: productId,
            affiliateVariationId: r.variationId, // may be null
            country: r.country,
            quantity: r.quantity,
          })),
        );
      }

      // per-variation stock from body.variations
      if (body.variations) {
        for (const v of body.variations) {
          if (!v.stock) continue;
          for (const [wId, byCountry] of Object.entries(v.stock)) {
            for (const [country, qty] of Object.entries(byCountry)) {
              if (qty > 0) {
                stockRows.push({
                  warehouseId: wId,
                  affiliateProductId: productId,
                  affiliateVariationId: v.id,
                  country,
                  quantity: qty,
                });
              }
            }
          }
        }
      }

      // insert stock rows
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
            tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }

      // stockStatus
      await trx
        .updateTable("affiliateProducts")
        .set({
          stockStatus:
            stockRows.length && (body.manageStock ?? true) ? "managed" : "unmanaged",
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
   DELETE – remove product and children (Next 16 params fix)
   ════════════════════════════════════════════════════════════ */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  // clear stock first
  await db
    .deleteFrom("warehouseStock")
    .where("affiliateProductId", "=", id)
    .execute();

  // remove variations
  await db
    .deleteFrom("affiliateProductVariations")
    .where("productId", "=", id)
    .execute();

  // finally the product
  await db
    .deleteFrom("affiliateProducts")
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .execute();

  return NextResponse.json({ id, deleted: true });
}
