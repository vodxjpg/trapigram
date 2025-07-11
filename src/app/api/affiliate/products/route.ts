/* /src/app/api/affiliate/products/route.ts */
export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { splitPointsByLevel, mergePointsByLevel } from "@/hooks/affiliatePoints";

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
  GET   – fixed “IN ()” syntax error when there are no products
  =================================================================*/
export async function GET(req: NextRequest) {
  /* 1) resolve auth/context ------------------------------------------------ */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, tenantId } = ctx;

  /* 2) pagination + search ------------------------------------------------- */
  const { searchParams } = new URL(req.url);
  const limit = Number(searchParams.get("limit") || "50");
  const offset = Number(searchParams.get("offset") || "0");
  const search = searchParams.get("search") || "";

  /* 3) base product rows --------------------------------------------------- */
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

  /* 4) warehouse stock – only query if we actually have product IDs -------- */
  const ids = rows.map((r) => r.id);
  let stockRows: {
    affiliateProductId: string;
    warehouseId: string;
    country: string;
    quantity: number;
  }[] = [];

  if (ids.length) {
    stockRows = await db
      .selectFrom("warehouseStock")
      .select([
        "affiliateProductId",
        "warehouseId",
        "country",
        "quantity",
      ])
      .where("affiliateProductId", "in", ids)
      .execute();
  }

  /* 5) build nested stock map --------------------------------------------- */
  const stockMap: Record<string, Record<string, Record<string, number>>> = {};
  for (const { affiliateProductId, warehouseId, country, quantity } of stockRows) {
    stockMap[affiliateProductId] ??= {};
    stockMap[affiliateProductId][warehouseId] ??= {};
    stockMap[affiliateProductId][warehouseId][country] = quantity;
  }

  /* 6) stitch & respond ---------------------------------------------------- */
  const products = rows.map((r) => ({
    id: r.id,
    title: r.title,
    image: r.image,
    sku: r.sku,
    status: r.status,
    productType: r.productType,
    pointsPrice: mergePointsByLevel(r.regularPoints as any, r.salePoints as any),
    cost: r.cost,
    stock: stockMap[r.id] ?? {},
    createdAt: r.createdAt,
  }));

  return NextResponse.json({ products });
}


/*==================================================================
  POST
  =================================================================*/
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, tenantId } = ctx;

  let body: z.infer<typeof productSchema>;
  try {
    body = productSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    throw err;
  }

  const sku = await uniqueSku(body.sku || `SKU-${uuidv4().slice(0, 8)}`, organizationId);

  const productId = uuidv4();
  const { regularPoints, salePoints } = splitPointsByLevel(body.pointsPrice);

  await db
    .insertInto("affiliateProducts")
    .values({
      id: productId,
      organizationId,
      tenantId,                       /* FIX */
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
    for (const a of body.attributes)
      for (const termId of a.selectedTerms)
        await db
          .insertInto("productAttributeValues")
          .values({ productId, attributeId: a.id, termId })
          .execute();
  }

  /* variations … (unchanged logic) */
  const variationStockRows: {
    warehouseId: string;
    affiliateProductId: string;
    variationId: string | null;
    country: string;
    quantity: number;
  }[] = [];

  if (body.productType === "variable" && body.variations?.length) {
    for (const v of body.variations) {
      const srcMap = v.prices ?? v.pointsPrice;
      const { regularPoints, salePoints } = splitPointsByLevel(srcMap);

      await db
        .insertInto("affiliateProductVariations")
        .values({
          id: v.id,
          productId,
          attributes: JSON.stringify(v.attributes),
          sku: v.sku,
          image: v.image ?? null,
          regularPoints,
          salePoints,
          cost: v.cost ?? {},
          minLevelId: v.minLevelId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();

      if (v.stock) {
        for (const [wId, byCountry] of Object.entries(v.stock))
          for (const [country, qty] of Object.entries(byCountry))
            if (qty > 0)
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
        tenantId,                       /* FIX */
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
