// src/app/api/affiliate-products/[id]/route.ts
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

/* ══════════════════════════════════════════════════════════════
   ZOD SCHEMAS
   ════════════════════════════════════════════════════════════ */
const countryPts = z.object({
  regular: z.number().min(0),
  sale: z.number().nullable(),
});
const pointsMap = z.record(z.string(), countryPts);

const patchSchema = z.object({
  title: z.string().optional(),
  description: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().optional(),
  status: z.enum(["published", "draft"]).optional(),
  allowBackorders: z.boolean().optional(),
  manageStock: z.boolean().optional(),
  pointsPrice: pointsMap.optional(),          // full replacement
});

/* helper to split points back into two JSONB columns */
function splitPoints(
  map: Record<string, { regular: number; sale: number | null }>,
) {
  const regular: Record<string, number> = {};
  const sale: Record<string, number> = {};
  for (const [c, v] of Object.entries(map)) {
    regular[c] = v.regular;
    if (v.sale != null) sale[c] = v.sale;
  }
  return { regularPoints: regular, salePoints: Object.keys(sale).length ? sale : null };
}

/* ══════════════════════════════════════════════════════════════
   GET – single product
   ════════════════════════════════════════════════════════════ */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: _req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 });

  const { id } = params;

  const product = await db
    .selectFrom("affiliateProducts")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", organizationId)
    .executeTakeFirst();

  if (!product)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  /* variations */
  const variations = await db
    .selectFrom("affiliateProductVariations")
    .selectAll()
    .where("productId", "=", product.id)
    .execute();

  /* stock rows */
  const stockRows = await db
    .selectFrom("warehouseStock")
    .select([
      "warehouseId",
      "variationId",
      "country",
      "quantity",
    ])
    .where("affiliateProductId", "=", product.id)
    .execute();

  /* build response */
  const mergedPoints = mergePoints(
    product.regularPoints as any,
    product.salePoints as any,
  );

  const mappedVariations = variations.map(v => ({
    ...v,
    pointsPrice: mergePoints(v.regularPoints as any, v.salePoints as any),
  }));

  return NextResponse.json({
    product: {
      ...product,
      pointsPrice: mergedPoints,
      variations: mappedVariations,
      warehouseStock: stockRows,
    },
  });
}

/* merge two point maps ➜ {country:{regular,sale}} */
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
   PATCH – update
   ════════════════════════════════════════════════════════════ */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 });

  const { id } = params;
  const data = patchSchema.parse(await req.json());
  if (!Object.keys(data).length)
    return NextResponse.json({ message: "Nothing to update" });

  /* ------- core product fields ------------------------------ */
  const core: Record<string, unknown> = {
    updatedAt: new Date(),
  };
  for (const k of [
    "title",
    "description",
    "image",
    "sku",
    "status",
    "allowBackorders",
    "manageStock",
  ] as const) {
    if (k in data) core[k] = (data as any)[k];
  }

  if (Object.keys(core).length > 1) {
    await db
      .updateTable("affiliateProducts")
      .set(core)
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .execute();
  }

  /* ------- points map replacement --------------------------- */
  if (data.pointsPrice) {
    const { regularPoints, salePoints } = splitPoints(data.pointsPrice);
    await db
      .updateTable("affiliateProducts")
      .set({
        regularPoints,
        salePoints,
        updatedAt: new Date(),
      })
      .where("id", "=", id)
      .execute();
  }

  return NextResponse.json({ id, updated: true });
}

/* ══════════════════════════════════════════════════════════════
   DELETE – remove product + children
   ════════════════════════════════════════════════════════════ */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const session = await auth.api.getSession({ headers: _req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const organizationId = session.session.activeOrganizationId;
  if (!organizationId)
    return NextResponse.json({ error: "No org" }, { status: 400 });

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
