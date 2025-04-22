import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

/* ------------------------------------------------------------------ */
/* helper – merge regular/sale JSON objects ➜ { IT:{regular, sale}, …} */
function mergePriceMaps(
  regular: Record<string, number> | null,
  sale: Record<string, number> | null,
) {
  const map: Record<string, { regular: number; sale: number | null }> = {};
  const reg = regular || {};
  const sal = sale   || {};
  for (const [c, v] of Object.entries(reg)) map[c] = { regular: Number(v), sale: null };
  for (const [c, v] of Object.entries(sal))
    map[c] = { ...(map[c] || { regular: 0, sale: null }), sale: Number(v) };
  return map;
}

/* ------------------------------------------------------------------ */
/* helper – split map ➜ {regularPrice, salePrice} (JSONB ready)       */
/* ------------------------------------------------------------------ */
const priceObj = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
const costMap  = z.record(z.string(), z.number().min(0))

function splitPrices(
  pr: Record<string, { regular: number; sale: number | null }>,
) {
  const regular: Record<string, number> = {};
  const sale: Record<string, number> = {};
  for (const [c, v] of Object.entries(pr)) {
    regular[c] = v.regular;
    if (v.sale != null) sale[c] = v.sale;
  }
  return {
    regularPrice: regular,
    salePrice: Object.keys(sale).length ? sale : null,
  };
}

/* ------------------------------------------------------------------ */
/*  Zod schema for PATCH                                              */
/* ------------------------------------------------------------------ */
const warehouseStockSchema = z.array(z.object({
  warehouseId: z.string(),
  productId: z.string(),
  variationId: z.string().nullable(),
  country: z.string(),
  quantity: z.number().min(0),
}))

const variationPatchSchema = z.union([
  z.object({
    id: z.string(),
    attributes: z.record(z.string(), z.string()),
    sku: z.string(),
    image: z.string().nullable().optional(),
    prices: z.record(z.string(), priceObj),
    cost: costMap.optional(),
  }),
]);

const productUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1, "SKU is required").optional(),
  status: z.enum(["published", "draft"]).optional(),
  productType: z.enum(["simple", "variable"]).optional(),
  categories: z.array(z.string()).optional(),
  prices: z.record(z.string(), priceObj).optional(),
  cost: costMap.optional(),
  allowBackorders: z.boolean().optional(),
  manageStock: z.boolean().optional(),
  warehouseStock: warehouseStockSchema.optional(),
  attributes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        terms: z.array(z.object({ id: z.string(), name: z.string() })),
        useForVariations: z.boolean(),
        selectedTerms: z.array(z.string()),
      }),
    )
    .optional(),
  variations: z.array(variationPatchSchema).optional(),
});

/* ================================================================== */
/*  GET                                                               */
/* ================================================================== */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  /* ---------- auth ------------------------------------------------ */
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = session.session.activeOrganizationId;
  if (!orgId)
    return NextResponse.json({ error: "No active organization" }, { status: 400 });

  /* ---------- product row ---------------------------------------- */
  const raw = await db
    .selectFrom("products")
    .selectAll()
    .where("id", "=", id)
    .where("organizationId", "=", orgId)
    .executeTakeFirst();
  if (!raw)
    return NextResponse.json({ error: "Product not found" }, { status: 404 });

  /* ---------- categories ----------------------------------------- */
  const categoryRows = await db
    .selectFrom("productCategory")
    .innerJoin(
      "productCategories",
      "productCategories.id",
      "productCategory.categoryId",
    )
    .select(["productCategories.id"])
    .where("productCategory.productId", "=", id)
    .execute();
  const categories = categoryRows.map((r) => r.id);

  /* ---------- attributes ----------------------------------------- */
  const attrRows = await db
    .selectFrom("productAttributeValues")
    .innerJoin(
      "productAttributes",
      "productAttributes.id",
      "productAttributeValues.attributeId",
    )
    .innerJoin(
      "productAttributeTerms",
      "productAttributeTerms.id",
      "productAttributeValues.termId",
    )
    .select([
      "productAttributeValues.attributeId as id",
      "productAttributes.name as name",
      "productAttributeTerms.id as termId",
      "productAttributeTerms.name as termName",
    ])
    .where("productAttributeValues.productId", "=", id)
    .execute();
  const attributes = attrRows.reduce<any[]>((acc, row) => {
    let attr = acc.find((a) => a.id === row.id);
    if (!attr) {
      attr = {
        id: row.id,
        name: row.name,
        terms: [],
        selectedTerms: [],
        useForVariations: false,
      };
      acc.push(attr);
    }
    attr.terms.push({ id: row.termId, name: row.termName });
    attr.selectedTerms.push(row.termId);
    return acc;
  }, []);

  /* ---------- stock data ----------------------------------------- */
  const stockRows = await db
    .selectFrom("warehouseStock")
    .select(["warehouseId", "country", "quantity", "variationId"])
    .where("productId", "=", id)
    .execute();

  const stockData = stockRows
    .filter(row => !row.variationId)
    .reduce((acc, row) => {
      if (!acc[row.warehouseId]) acc[row.warehouseId] = {};
      acc[row.warehouseId][row.country] = row.quantity;
      return acc;
    }, {} as Record<string, Record<string, number>>);

  /* ---------- variations (if any) -------------------------------- */
  let variationsRaw: any[] = [];
  if (raw.productType === "variable") {
    variationsRaw = await db
      .selectFrom("productVariations")
      .selectAll()
      .where("productId", "=", id)
      .execute();
  }

  const cost = raw.cost && typeof raw.cost === "string" ? JSON.parse(raw.cost) : raw.cost ?? {}

  const variations = variationsRaw.map((v) => {
    const reg =
      v.regularPrice && typeof v.regularPrice === "string"
        ? JSON.parse(v.regularPrice)
        : v.regularPrice;
    const sal =
      v.salePrice && typeof v.salePrice === "string"
        ? JSON.parse(v.salePrice)
        : v.salePrice;
    const cost = typeof v.cost === "string" ? JSON.parse(v.cost) : v.cost ?? {}
    return {
      id: v.id,
      attributes: v.attributes,
      sku: v.sku,
      image: v.image,
      prices: mergePriceMaps(reg, sal),
      cost,
      stock: stockRows
        .filter(row => row.variationId === v.id)
        .reduce((acc, row) => {
          if (!acc[row.warehouseId]) acc[row.warehouseId] = {};
          acc[row.warehouseId][row.country] = row.quantity;
          return acc;
        }, {} as Record<string, Record<string, number>>),
    };
  });

  /* ---------- price parsing ------------------------------ */
  const reg =
    raw.regularPrice && typeof raw.regularPrice === "string"
      ? JSON.parse(raw.regularPrice)
      : raw.regularPrice;
  const sal =
    raw.salePrice && typeof raw.salePrice === "string"
      ? JSON.parse(raw.salePrice)
      : raw.salePrice;

  /* ---------- final product payload ------------------------------ */
  const product = {
    ...raw,
    prices: mergePriceMaps(reg, sal),
    cost,
    stockData,
    stockStatus: raw.manageStock ? "managed" : "unmanaged",
    categories,
    attributes: attributes.map((a) => ({
      ...a,
      useForVariations: raw.productType === "variable",
    })),
    variations,
  };

  return NextResponse.json({ product });
}

/* ================================================================== */
/*  PATCH                                                             */
/* ================================================================== */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json(
        { error: "Unauthorized: No session found" },
        { status: 401 },
      );
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId)
      return NextResponse.json({ error: "No active organization" }, { status: 400 });

    const tenant = await db
      .selectFrom("tenant")
      .select(["id"])
      .where("ownerUserId", "=", session.user.id)
      .executeTakeFirst();
    if (!tenant)
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    const tenantId = tenant.id;

    const { id } = await params;
    const body = await req.json();
    const parsedUpdate = productUpdateSchema.parse(body);

    /* -------------------------------------------------------------- */
    /*  sanity / FK checks                                           */
    /* -------------------------------------------------------------- */
    const existingProduct = await db
      .selectFrom("products")
      .select("id")
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();
    if (!existingProduct)
      return NextResponse.json({ error: "Product not found" }, { status: 404 });

    if (parsedUpdate.sku) {
      const conflict = await db
        .selectFrom("products")
        .select("id")
        .where("sku", "=", parsedUpdate.sku)
        .where("id", "!=", id)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      if (conflict)
        return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
    }

    if (parsedUpdate.categories?.length) {
      const validIds = (
        await db
          .selectFrom("productCategories")
          .select("id")
          .where("organizationId", "=", organizationId)
          .execute()
      ).map((c) => c.id);
      const bad = parsedUpdate.categories.filter((cid) => !validIds.includes(cid));
      if (bad.length)
        return NextResponse.json(
          { error: `Invalid category IDs: ${bad.join(", ")}` },
          { status: 400 },
        );
    }

    /* -------------------------------------------------------------- */
    /*  build update payload                                          */
    /* -------------------------------------------------------------- */
    const updateCols: Record<string, any> = {
      title: parsedUpdate.title,
      description: parsedUpdate.description,
      image: parsedUpdate.image,
      sku: parsedUpdate.sku,
      status: parsedUpdate.status,
      productType: parsedUpdate.productType,
      allowBackorders: parsedUpdate.allowBackorders,
      manageStock: parsedUpdate.manageStock,
      stockStatus: parsedUpdate.manageStock ? "managed" : "unmanaged",
      updatedAt: new Date(),
    };

    /* ----------  pricing  ----------------------------------------- */
    if (parsedUpdate.prices) {
      const { regularPrice, salePrice } = splitPrices(parsedUpdate.prices);
      updateCols.regularPrice = regularPrice;
      updateCols.salePrice = salePrice;
    }

    if (parsedUpdate.cost) updateCols.cost = parsedUpdate.cost;

    await db.updateTable("products").set(updateCols).where("id", "=", id).execute();

    /* -------------------------------------------------------------- */
    /*  categories                                                  */
    /* -------------------------------------------------------------- */
    if (parsedUpdate.categories) {
      await db.deleteFrom("productCategory").where("productId", "=", id).execute();
      for (const cid of parsedUpdate.categories)
        await db
          .insertInto("productCategory")
          .values({ productId: id, categoryId: cid })
          .execute();
    }

    /* -------------------------------------------------------------- */
    /*  attributes                                                  */
    /* -------------------------------------------------------------- */
    if (parsedUpdate.attributes) {
      await db
        .deleteFrom("productAttributeValues")
        .where("productId", "=", id)
        .execute();
      for (const a of parsedUpdate.attributes)
        for (const termId of a.selectedTerms)
          await db
            .insertInto("productAttributeValues")
            .values({ productId: id, attributeId: a.id, termId })
            .execute();
    }

    /* -------------------------------------------------------------- */
    /*  variations (variable products)                               */
    /* -------------------------------------------------------------- */
    if (parsedUpdate.productType === "variable" && parsedUpdate.variations) {
      await db.deleteFrom("productVariations").where("productId", "=", id).execute();

      for (const v of parsedUpdate.variations) {
        const { regularPrice, salePrice } = splitPrices(v.prices);
        await db
          .insertInto("productVariations")
          .values({
            id: v.id,
            productId: id,
            attributes: JSON.stringify(v.attributes),
            sku: v.sku,
            image: v.image ?? null,
            regularPrice,
            salePrice,
            cost: v.cost ?? {},
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }
    }

    /* -------------------------------------------------------------- */
    /*  warehouseStock                                              */
    /* -------------------------------------------------------------- */
    if (parsedUpdate.warehouseStock) {
      await db.deleteFrom("warehouseStock").where("productId", "=", id).execute();
      for (const entry of parsedUpdate.warehouseStock) {
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
        }).execute();
      }
    }

    return NextResponse.json({
      product: { id, ...parsedUpdate, updatedAt: new Date().toISOString() },
    });
  } catch (error) {
    const { id } = await params;
    console.error(`[PRODUCT_PATCH_${id}]`, error);
    if (error instanceof z.ZodError)
      return NextResponse.json({ error: error.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ================================================================== */
/*  DELETE                                                            */
/* ================================================================== */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    const { id } = await params;
    const existingProduct = await db
      .selectFrom("products")
      .select("id")
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    await db.deleteFrom("productCategory").where("productId", "=", id).execute();
    await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
    await db.deleteFrom("productVariations").where("productId", "=", id).execute();
    await db.deleteFrom("products").where("id", "=", id).execute();
    return NextResponse.json({ message: "Product deleted successfully" });
  } catch (error) {
    const { id } = await params;
    console.error(`[PRODUCT_DELETE_${id}]`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}