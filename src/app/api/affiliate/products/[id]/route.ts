// ==================================================================
//  src/app/api/affiliate/products/[id]/route.ts
// ==================================================================
export const runtime = "nodejs";

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { v4 as uuidv4 } from "uuid";

import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

/*─────────────────────────────────────────────────────────────────
  Robust JSON helpers + strict split/merge for points-by-level
─────────────────────────────────────────────────────────────────*/
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

type PointsByLvl = Record<
  string,
  Record<string, { regular: number; sale: number | null }>
>;
type RegularMap = Record<string, Record<string, number>>;
type SaleMap = Record<string, Record<string, number>>;

function mergePointsStrict(
  regular: RegularMap | null | undefined,
  sale: SaleMap | null | undefined,
): PointsByLvl {
  const reg = regular ?? {};
  const sal = sale ?? {};
  const levelIds = new Set<string>([...Object.keys(reg), ...Object.keys(sal)]);
  const out: PointsByLvl = {};
  for (const lvl of levelIds) {
    out[lvl] = out[lvl] ?? {};
    const countries = new Set<string>([
      ...Object.keys(reg[lvl] ?? {}),
      ...Object.keys(sal[lvl] ?? {}),
    ]);
    for (const cc of countries) {
      const r = reg[lvl]?.[cc] ?? 0;
      const s = sal[lvl]?.[cc];
      out[lvl][cc] = { regular: Number.isFinite(r) ? r : 0, sale: s ?? null };
    }
  }
  return out;
}

function splitPointsStrict(
  map: PointsByLvl,
): { regularPoints: RegularMap; salePoints: SaleMap | null } {
  const regularPoints: RegularMap = {};
  const salePoints: SaleMap = {};
  let hasAnySale = false;

  for (const [lvl, byCountry] of Object.entries(map || {})) {
    regularPoints[lvl] = regularPoints[lvl] ?? {};
    for (const [cc, pts] of Object.entries(byCountry || {})) {
      const r = Number(pts?.regular ?? 0);
      regularPoints[lvl][cc] = Number.isFinite(r) && r >= 0 ? r : 0;
      if (pts?.sale === 0 || typeof pts?.sale === "number") {
        salePoints[lvl] = salePoints[lvl] ?? {};
        salePoints[lvl][cc] = pts.sale!;
        hasAnySale = true;
      }
    }
  }
  return { regularPoints, salePoints: hasAnySale ? salePoints : null };
}

/* Deep merge of UI maps (used during PATCH) */
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
const countryMap = z.record(z.string(), ptsObj);
const pointsByLvl = z.record(z.string(), countryMap);

const stockMap = z.record(z.string(), z.record(z.string(), z.number().min(0)));
const costMap = z.record(z.string(), z.number().min(0));

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
  useForVariations: z.boolean().optional(),
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
  cost: z.record(z.string(), z.number().min(0)).optional(),
  attributes: z.array(attrInput).optional(),
  minLevelId: z.string().uuid().nullable().optional(),
  warehouseStock: z
    .array(
      z.object({
        warehouseId: z.string(),
        affiliateProductId: z.string(),
        variationId: z.string().nullable(),
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

  const product = await db
    .selectFrom("affiliateProducts")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();

  if (!product) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const variations = await db
    .selectFrom("affiliateProductVariations")
    .selectAll()
    .where("productId", "=", product.id)
    .execute();

  const stockRows = await db
    .selectFrom("warehouseStock")
    .select(["warehouseId", "affiliateVariationId", "country", "quantity"])
    .where("affiliateProductId", "=", product.id)
    .execute();

  const variationStock: Record<string, ReturnType<typeof stockMap.parse>> = {};
  for (const row of stockRows) {
    if (!row.affiliateVariationId) continue;
    const vid = row.affiliateVariationId;
    if (!variationStock[vid]) variationStock[vid] = {};
    if (!variationStock[vid][row.warehouseId]) variationStock[vid][row.warehouseId] = {};
    variationStock[vid][row.warehouseId][row.country] = row.quantity;
  }

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
    const vRegular = jsonMaybe<RegularMap>(v.regularPoints) ?? {};
    const vSale = jsonMaybe<SaleMap | null>(v.salePoints) ?? null;
    const vAttrs =
      typeof v.attributes === "string"
        ? jsonMaybe<Record<string, string>>(v.attributes) ?? {}
        : (v.attributes as any);
    const vCost =
      typeof v.cost === "string" ? jsonMaybe<Record<string, number>>(v.cost) ?? {} : (v.cost as any) ?? {};

    const pointsPrice = mergePointsStrict(vRegular, vSale);

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

  const pRegular = jsonMaybe<RegularMap>(product.regularPoints) ?? {};
  const pSale = jsonMaybe<SaleMap | null>(product.salePoints) ?? null;
  const pCost =
    typeof product.cost === "string"
      ? jsonMaybe<Record<string, number>>(product.cost) ?? {}
      : (product.cost as any) ?? {};

  return NextResponse.json({
    product: {
      ...product,
      pointsPrice: mergePointsStrict(pRegular, pSale),
      cost: pCost,
      warehouseStock: stockRows.filter((r) => !r.affiliateVariationId),
      variations: mappedVariations,
      attributes: attributesOut,
    },
  });
}

/* =================================================================
   PATCH – deep-merge incoming points with existing, strict split
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
      const core: Record<string, unknown> = {};
      if (body.title !== undefined) core.title = body.title;
      if (body.description !== undefined) core.description = body.description;
      if (body.image !== undefined) core.image = body.image;
      if (body.sku !== undefined) core.sku = body.sku;
      if (body.status !== undefined) core.status = body.status;
      if (body.productType !== undefined) core.productType = body.productType;
      if (body.allowBackorders !== undefined) core.allowBackorders = body.allowBackorders;
      if (body.manageStock !== undefined) core.manageStock = body.manageStock;

      // Points: deep-merge UI maps, then split strictly
      if (body.pointsPrice) {
        const existing = await trx
          .selectFrom("affiliateProducts")
          .select(["regularPoints", "salePoints"])
          .where("id", "=", productId)
          .executeTakeFirst();

        const existingRegular = jsonMaybe<RegularMap>(existing?.regularPoints) ?? {};
        const existingSale = jsonMaybe<SaleMap | null>(existing?.salePoints) ?? null;
        const currentPoints = mergePointsStrict(existingRegular, existingSale);
        const mergedPoints = deepMergePoints(currentPoints, body.pointsPrice as PointsByLvl);
        const sp = splitPointsStrict(mergedPoints);

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

      /* attributes */
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

      /* variations */
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
              regular: jsonMaybe<RegularMap>(r.regularPoints) ?? {},
              sale: jsonMaybe<SaleMap | null>(r.salePoints) ?? null,
            },
          ]),
        );
        const existingIds = existingRows.map((r) => r.id);

        // delete removed
        const incomingIds = body.variations.map((v) => v.id);
        const toDelete = existingIds.filter((id) => !incomingIds.includes(id));
        if (toDelete.length) {
          await trx
            .deleteFrom("affiliateProductVariations")
            .where("id", "in", toDelete)
            .execute();
        }

        for (const v of body.variations) {
          const incomingSrc = (v.prices ?? v.pointsPrice) as PointsByLvl | undefined;

          let mergedForVar: PointsByLvl | null = null;
          if (incomingSrc) {
            const prev = existingById.get(v.id);
            const prevMerged = mergePointsStrict(prev?.regular ?? {}, prev?.sale ?? null);
            mergedForVar = deepMergePoints(prevMerged, incomingSrc);
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
            const sp = splitPointsStrict(mergedForVar);
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
            if (!mergedForVar) {
              const sp = splitPointsStrict((incomingSrc ?? {}) as PointsByLvl);
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

      /* warehouse stock */
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

      if (body.warehouseStock) {
        stockRows.push(
          ...body.warehouseStock.map((r) => ({
            warehouseId: r.warehouseId,
            affiliateProductId: productId,
            affiliateVariationId: r.variationId,
            country: r.country,
            quantity: r.quantity,
          })),
        );
      }

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
