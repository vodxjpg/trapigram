import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import { splitPointsByLevel, mergePointsByLevel } from "@/hooks/affiliatePoints"; // ⬅︎ add

/* ──────────────────────────────────────────────────────────────── */
/*  Zod helpers                                                     */
/* ──────────────────────────────────────────────────────────────── */
const ptsObj       = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
const countryMap   = z.record(z.string(), ptsObj);          // country ➜ points
const pointsByLvl  = z.record(z.string(), countryMap);      // levelId ➜ country map
const costMap   = z.record(z.string(), z.number().min(0));

/* stock map used inside each variation */
const stockMap = z.record(z.string(), z.record(z.string(), z.number().min(0)));

/* ----------------------- variations ---------------------------- */
const variationSchema = z
  .object({
    id: z.string(),
    attributes: z.record(z.string(), z.string()),
    sku: z.string().min(1),
    image: z.string().nullable().optional(),
    pointsPrice: pointsByLvl.optional(), // new name (alias below)
    prices: pointsByLvl.optional(),
    stock: stockMap.optional(),
    cost:   costMap.optional(),
    minLevelId: z.string().uuid().nullable().optional(),
  })
  .transform((v) => ({ ...v, pointsPrice: v.pointsPrice ?? v.prices! }));

/* ----------------------- warehouse stock rows ------------------ */
const warehouseStockSchema = z.array(
  z.object({
    warehouseId: z.string(),
    affiliateProductId: z.string(),
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);

/* ----------------------- product ------------------------------- */
const attributeInput = z.object({
  id: z.string(),
  selectedTerms: z.array(z.string()),
  useForVariations: z.boolean().optional(), // <‑‑ accepted but not stored
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
  cost:        costMap.optional(),
  attributes: z.array(attributeInput).optional(),
  variations: z.array(variationSchema).optional(),
  warehouseStock: warehouseStockSchema.optional(),
  minLevelId: z.string().uuid().nullable().optional(),
});

/* ──────────────────────────────────────────────────────────────── */
/*  helpers                                                        */
/* ──────────────────────────────────────────────────────────────── */
function splitPoints(map: Record<string, { regular: number; sale: number | null }>) {
  const regular: Record<string, number> = {};
  const sale: Record<string, number> = {};
  for (const [c, v] of Object.entries(map)) {
    regular[c] = v.regular;
    if (v.sale != null) sale[c] = v.sale;
  }
  return { regularPoints: regular, salePoints: Object.keys(sale).length ? sale : null };
}

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

/* =================================================================
   GET – list affiliate products
   ================================================================= */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const organizationId = session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", session.user.id)
      .executeTakeFirst();
    if (!tenant) return NextResponse.json({ error: "No tenant for user" }, { status: 404 });

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
        "createdAt",
      ])
      .where("organizationId", "=", organizationId)
      .where("tenantId", "=", tenant.id)
      .$if(search, (qb) => qb.where("title", "ilike", `%${search}%`))
      .limit(limit)
      .offset(offset)
      .execute();

    const products = rows.map((r) => ({
      id: r.id,
      title: r.title,
      image: r.image,
      sku: r.sku,
      status: r.status,
      productType: r.productType,
      pointsPrice: mergePointsByLevel(r.regularPoints as any, r.salePoints as any),
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ products });
  } catch (err) {
    console.error("[AFFILIATE_PRODUCTS_GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* helper: merge two DB JSONB columns into map */
function mergePoints(
  regular: Record<string, number> | null,
  sale: Record<string, number> | null,
) {
  const out: Record<string, { regular: number; sale: number | null }> = {};
  const reg = regular || {};
  const sal = sale || {};
  for (const [c, v] of Object.entries(reg)) out[c] = { regular: Number(v), sale: null };
  for (const [c, v] of Object.entries(sal)) out[c] = { ...(out[c] || { regular: 0, sale: null }), sale: Number(v) };
  return out;
}

/* =================================================================
   POST – create affiliate product (incl. variation stock)
   ================================================================= */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return NextResponse.json({ error: "No active organization" }, { status: 400 });

  const tenant = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", session.user.id)
    .executeTakeFirst();
  if (!tenant) return NextResponse.json({ error: "No tenant for user" }, { status: 404 });

  /* validation */
  let body: z.infer<typeof productSchema>;
  try {
    body = productSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    throw err;
  }

  /* SKU */
  const sku = await uniqueSku(body.sku || `SKU-${uuidv4().slice(0, 8)}`, organizationId);

  /* insert core product */
  const productId = uuidv4();
  const { regularPoints, salePoints } = splitPointsByLevel(body.pointsPrice);

  await db
  .insertInto("affiliateProducts")
  .values({
    id: productId,
    organizationId,
    tenantId: tenant.id,
    title: body.title,
    description: body.description ?? null,
    image: body.image ?? null,
    sku,
    status: body.status,
    productType: body.productType,
    regularPoints,
    salePoints,
    cost: body.cost ?? {},                                      // ← FIX
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

  /* variations (variable products) */
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
          cost: body.cost ?? {},
          minLevelId: body.minLevelId ?? null,
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
        variationId: row.variationId, // still filled (legacy) for FK but will be null when variable
        affiliateVariationId: row.variationId, // new FK column
        country: row.country,
        quantity: row.quantity,
        organizationId,
        tenantId: tenant.id,
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