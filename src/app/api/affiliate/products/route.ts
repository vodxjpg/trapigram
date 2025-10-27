/* /src/app/api/affiliate/products/route.ts */
export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
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
  string, // levelId or "default"
  Record<
    string, // country code
    { regular: number; sale: number | null }
  >
>;

type RegularMap = Record<string, Record<string, number>>;
type SaleMap = Record<string, Record<string, number>>;

/** Merge DB maps -> UI map */
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

/** Split UI map -> DB maps (sale null => omit; returns null if no sale anywhere) */
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

/*──────────────── Zod (unchanged shapes) ────────────────*/
const ptsObj = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
const countryMap = z.record(z.string(), ptsObj);
const pointsByLvl = z.record(z.string(), countryMap);
const costMap = z.record(z.string(), z.number().min(0));
const stockMap = z.record(z.string(), z.record(z.string(), z.number().min(0)));

const variationSchema = z
  .object({
    id: z.string(),
    attributes: z.record(z.string(), z.string()),
    sku: z.string().min(1),
    image: z.string().nullable().optional(),
    pointsPrice: pointsByLvl.optional(),
    prices: pointsByLvl.optional(),
    stock: stockMap.optional(),
    cost: costMap.optional(),
    minLevelId: z.string().uuid().nullable().optional(),
  })
  .transform((v) => ({ ...v, pointsPrice: v.pointsPrice ?? v.prices! }));

const warehouseStockSchema = z.array(
  z.object({
    warehouseId: z.string(),
    affiliateProductId: z.string(),
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);

const attributeInput = z.object({
  id: z.string(),
  selectedTerms: z.array(z.string()),
  useForVariations: z.boolean().optional(),
});

const productSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  allowBackorders: z.boolean(),
  manageStock: z.boolean(),
  pointsPrice: pointsByLvl,
  cost: costMap.optional(),
  attributes: z.array(attributeInput).optional(),
  variations: z.array(variationSchema).optional(),
  warehouseStock: warehouseStockSchema.optional(),
  minLevelId: z.string().uuid().nullable().optional(),
});

/*──────────────── helpers ────────────────*/
async function uniqueSku(base: string, orgId: string) {
  let cand = base;
  while (
    await db
      .selectFrom("affiliateProducts")
      .select("id")
      .where("sku", "=", cand)
      .where("organizationId", "=", orgId)
      .executeTakeFirst()
  ) {
    cand = `SKU-${uuidv4().slice(0, 8)}`;
  }
  return cand;
}

/*==================================================================
  GET   – fixed IN () + strict JSON + strict merge
  =================================================================*/
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, tenantId } = ctx;

  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || "50");
  const offset = Number(searchParams.get("offset") || "0");
  const search = searchParams.get("search") || "";

  const rows = await db
    .selectFrom("affiliateProducts")
    .select([
      "id",
      "title",
      "image",
      "sku",
      "status",
      "productType",
      "regularPoints",
      "salePoints",
      "cost",
      "createdAt",
    ])
    .where("organizationId", "=", organizationId)
    .where("tenantId", "=", tenantId)
    .$if(search, (qb) => qb.where("title", "ilike", `%${search}%`))
    .limit(limit)
    .offset(offset)
    .execute();

  const ids = rows.map((r) => r.id);
  let stockRows:
    | {
        affiliateProductId: string;
        warehouseId: string;
        country: string;
        quantity: number;
      }[]
    | [] = [];

  if (ids.length) {
    stockRows = await db
      .selectFrom("warehouseStock")
      .select(["affiliateProductId", "warehouseId", "country", "quantity"])
      .where("affiliateProductId", "in", ids)
      .execute();
  }

  const byProductStock: Record<string, Record<string, Record<string, number>>> = {};
  for (const { affiliateProductId, warehouseId, country, quantity } of stockRows) {
    byProductStock[affiliateProductId] ??= {};
    byProductStock[affiliateProductId][warehouseId] ??= {};
    byProductStock[affiliateProductId][warehouseId][country] = quantity;
  }

  const products = rows.map((r) => {
    const regular = jsonMaybe<RegularMap>(r.regularPoints) ?? {};
    const sale = jsonMaybe<SaleMap | null>(r.salePoints) ?? null;
    const cost = jsonMaybe<Record<string, number>>(r.cost) ?? {};
    return {
      id: r.id,
      title: r.title,
      image: r.image,
      sku: r.sku,
      status: r.status,
      productType: r.productType,
      pointsPrice: mergePointsStrict(regular, sale),
      cost,
      stock: byProductStock[r.id] ?? {},
      createdAt: r.createdAt,
    };
  });

  return NextResponse.json({ products });
}

/*==================================================================
  POST – use strict split to guarantee default persistence
  =================================================================*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, tenantId } = ctx;

  let body: z.infer<typeof productSchema>;
  try {
    body = productSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    throw err;
  }

  const sku = await uniqueSku(body.sku || `SKU-${uuidv4().slice(0, 8)}`, organizationId);

  const productId = uuidv4();
  const { regularPoints, salePoints } = splitPointsStrict(body.pointsPrice);

  await db
    .insertInto("affiliateProducts")
    .values({
      id: productId,
      organizationId,
      tenantId,
      title: body.title,
      description: body.description ?? null,
      image: body.image ?? null,
      sku,
      status: body.status,
      productType: body.productType,
      regularPoints,
      salePoints,
      cost: body.cost ?? {},
      allowBackorders: body.allowBackorders,
      manageStock: body.manageStock,
      stockStatus: body.manageStock ? "managed" : "unmanaged",
      minLevelId: body.minLevelId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  /* attribute values */
  if (body.attributes?.length) {
    for (const a of body.attributes) {
      for (const termId of a.selectedTerms) {
        await db
          .insertInto("productAttributeValues")
          .values({ productId, attributeId: a.id, termId })
          .execute();
      }
    }
  }

  /* variations */
  const variationStockRows: {
    warehouseId: string;
    affiliateProductId: string;
    variationId: string | null;
    country: string;
    quantity: number;
  }[] = [];

  if (body.productType === "variable" && body.variations?.length) {
    for (const v of body.variations) {
      const srcMap = v.prices ?? v.pointsPrice ?? {};
      const { regularPoints: vr, salePoints: vs } = splitPointsStrict(srcMap as PointsByLvl);

      await db
        .insertInto("affiliateProductVariations")
        .values({
          id: v.id,
          productId,
          attributes: JSON.stringify(v.attributes),
          sku: v.sku,
          image: v.image ?? null,
          regularPoints: vr,
          salePoints: vs,
          cost: v.cost ?? {},
          minLevelId: v.minLevelId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();

      if (v.stock) {
        for (const [wId, byCountry] of Object.entries(v.stock)) {
          for (const [country, qty] of Object.entries(byCountry)) {
            if (qty > 0) {
              variationStockRows.push({
                warehouseId: wId,
                affiliateProductId: productId,
                variationId: v.id,
                country,
                quantity: qty,
              });
            }
          }
        }
      }
    }
  }

  /* warehouseStock */
  const stockRows = [
    ...(body.warehouseStock || []).map((r) => ({ ...r, affiliateProductId: productId })),
    ...variationStockRows,
  ];

  for (const row of stockRows) {
    await db
      .insertInto("warehouseStock")
      .values({
        id: uuidv4(),
        warehouseId: row.warehouseId,
        affiliateProductId: productId,
        variationId: null,
        affiliateVariationId: row.variationId,
        country: row.country,
        quantity: row.quantity,
        organizationId,
        tenantId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();
  }

  return NextResponse.json(
    { productId, sku, createdAt: new Date().toISOString() },
    { status: 201 },
  );
}
