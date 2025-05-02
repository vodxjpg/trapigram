// src/app/api/affiliate-products/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

/* ══════════════════════════════════════════════════════════════
   ZOD SCHEMAS
   ════════════════════════════════════════════════════════════ */
const countryPts = z.object({
  regular: z.number().min(0),
  sale: z.number().nullable(),
});

const pointsMap = z.record(z.string(), countryPts);

const warehouseStockSchema = z.array(
  z.object({
    warehouseId: z.string(),
    affiliateProductId: z.string(),          // NEW – FK to affiliate product
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);

const variationSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.string()),
  sku: z.string().min(1),
  image: z.string().nullable().optional(),
  pointsPrice: pointsMap,
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
  pointsPrice: pointsMap,                     // simple product points
  variations: z.array(variationSchema).optional(),
  warehouseStock: warehouseStockSchema.optional(),
});

/* ══════════════════════════════════════════════════════════════
   HELPERS
   ════════════════════════════════════════════════════════════ */
function splitPoints(
  map: Record<string, { regular: number; sale: number | null }>,
) {
  const regular: Record<string, number> = {};
  const sale: Record<string, number> = {};
  for (const [c, v] of Object.entries(map)) {
    regular[c] = v.regular;
    if (v.sale != null) sale[c] = v.sale;
  }
  return {
    regularPoints: regular,
    salePoints: Object.keys(sale).length ? sale : null,
  };
}

async function uniqueSku(base: string, organizationId: string) {
  let candidate = base;
  while (
    await db
      .selectFrom("affiliateProducts")
      .select("id")
      .where("sku", "=", candidate)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst()
  ) {
    candidate = `SKU-${uuidv4().slice(0, 8)}`;
  }
  return candidate;
}

/* ══════════════════════════════════════════════════════════════
   GET  – LIST AFFILIATE PRODUCTS
   ════════════════════════════════════════════════════════════ */
export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const organizationId = session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const userId = session.user.id;

    /* tenant ID (owner of org) */
    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", userId)
      .executeTakeFirst();
    if (!tenant)
      return NextResponse.json({ error: "No tenant for user" }, { status: 404 });
    const tenantId = tenant.id;

    /* pagination / search */
    const { searchParams } = new URL(req.url);
    const limit  = Number.parseInt(searchParams.get("limit")  || "50");
    const offset = Number.parseInt(searchParams.get("offset") || "0");
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
      .where("tenantId", "=", tenantId)
      .$if(search, qb => qb.where("title", "ilike", `%${search}%`))
      .limit(limit)
      .offset(offset)
      .execute();

    const products = rows.map(r => ({
      id: r.id,
      title: r.title,
      image: r.image,
      sku: r.sku,
      status: r.status,
      productType: r.productType,
      pointsPrice: mergePoints(r.regularPoints as any, r.salePoints as any),
      createdAt: r.createdAt,
    }));

    return NextResponse.json({ products });
  } catch (err) {
    console.error("[AFFILIATE_PRODUCTS_GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* merge {regularPoints},{salePoints} ➜ { country:{regular,sale} } */
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

/* ══════════════════════════════════════════════════════════════
   POST – CREATE AFFILIATE PRODUCT
   ════════════════════════════════════════════════════════════ */
export async function POST(req: NextRequest) {
  /* ---------- auth & org ------------------------------------ */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return NextResponse.json({ error: "No active organization" }, { status: 400 });

  /* ---------- tenant ---------------------------------------- */
  const tenant = await db
    .selectFrom("tenant")
    .select("id")
    .where("ownerUserId", "=", session.user.id)
    .executeTakeFirst();
  if (!tenant)
    return NextResponse.json({ error: "No tenant for user" }, { status: 404 });
  const tenantId = tenant.id;

  /* ---------- validate body --------------------------------- */
  let body;
  try {
    body = productSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    throw err;
  }

  /* ---------- SKU ------------------------------------------- */
  const finalSku = await uniqueSku(
    body.sku || `SKU-${uuidv4().slice(0, 8)}`,
    organizationId,
  );

  /* ---------- base product insert --------------------------- */
  const productId = uuidv4();
  const { regularPoints, salePoints } = splitPoints(body.pointsPrice);

  await db
    .insertInto("affiliateProducts")
    .values({
      id: productId,
      organizationId,
      tenantId,
      title: body.title,
      description: body.description ?? null,
      image: body.image ?? null,
      sku: finalSku,
      status: body.status,
      productType: body.productType,
      regularPoints,
      salePoints,
      cost: {},                              // kept for parity with money products
      allowBackorders: body.allowBackorders,
      manageStock: body.manageStock,
      stockStatus:
        body.manageStock && body.warehouseStock?.length
          ? "managed"
          : "unmanaged",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .execute();

  /* ---------- variations ------------------------------------ */
  if (body.productType === "variable" && body.variations?.length) {
    for (const v of body.variations) {
      const pts = splitPoints(v.pointsPrice);
      await db
        .insertInto("affiliateProductVariations")
        .values({
          id: v.id,
          productId,
          attributes: JSON.stringify(v.attributes),
          sku: v.sku,
          image: v.image ?? null,
          regularPoints: pts.regularPoints,
          salePoints: pts.salePoints,
          cost: {},
          stock: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();
    }
  }

  /* ---------- warehouseStock -------------------------------- */
  if (body.warehouseStock?.length) {
    for (const ws of body.warehouseStock) {
      await db
        .insertInto("warehouseStock")
        .values({
          id: uuidv4(),
          warehouseId: ws.warehouseId,
          affiliateProductId: productId,
          variationId: ws.variationId,
          country: ws.country,
          quantity: ws.quantity,
          organizationId,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .execute();
    }
  }

  return NextResponse.json(
    { productId, sku: finalSku, createdAt: new Date().toISOString() },
    { status: 201 },
  );
}
