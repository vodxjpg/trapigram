// src/app/api/products/route.ts
export const runtime = "nodejs";
import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sql } from "kysely";
import { propagateDeleteDeep } from "@/lib/propagate-delete";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

/* ------------------------------------------------------------------ */
/*  ZOD - schema                                                      */
/* ------------------------------------------------------------------ */
const priceObj = z.object({
  regular: z.number().min(0),
  sale: z.number().nullable(),
});

const costMap = z.record(z.string(), z.number().min(0));

const warehouseStockSchema = z.array(
  z.object({
    warehouseId: z.string(),
    productId: z.string(),
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);

const variationSchema = z.object({
  id: z.string(),
  attributes: z.record(z.string(), z.string()),
  sku: z.string(),
  image: z.string().nullable().optional(),
  prices: z.record(z.string(), priceObj),
  cost: costMap.optional(),
});

const productSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1).optional(),
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  prices: z.record(z.string(), priceObj).optional(),
  cost: costMap.optional(),
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
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
  variations: z.array(variationSchema).optional(),
});

/* helper: convert { ES: {regular:19, sale:10}, … } --> two JSON objects */
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

/* small helpers used to filter JSONB maps for shared copies */
function parseMap<T extends Record<string, any> | null>(m: any): T {
  if (!m) return {} as any;
  if (typeof m === "string") {
    try { return JSON.parse(m) as T; } catch { }
  }
  return (m || {}) as T;
}
function pickKeys<T>(m: Record<string, T> | null, keys: string[] | null): Record<string, T> | null {
  if (!m) return null;
  if (!keys || !keys.length) return {};
  const out: Record<string, T> = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(m, k)) out[k] = m[k];
  return Object.keys(out).length ? out : null;
}

/* ------------------------------------------------------------------ */
/*  GET – fixed pagination                                            */
/* ------------------------------------------------------------------ */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, tenantId } = ctx;

  try {
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "10");
    const search = searchParams.get("search") || "";

    // validated ordering
    const allowedCols = new Set(["createdAt", "updatedAt", "title", "sku"]);
    const rawOrderBy = searchParams.get("orderBy") || "createdAt";
    const orderBy = allowedCols.has(rawOrderBy) ? rawOrderBy : "createdAt";
    const orderDir = searchParams.get("orderDir") === "asc" ? "asc" : "desc";

    const categoryId = searchParams.get("categoryId") || "";
    const rawStatus = searchParams.get("status");
    const status: "published" | "draft" | undefined =
      rawStatus === "published" || rawStatus === "draft" ? rawStatus : undefined;

    const attributeTermId = searchParams.get("attributeTermId") || "";

    // Only list "owned" products (exclude SKUs with SHD prefix)
    const ownedOnly = ["1", "true", "yes"].includes(
      (searchParams.get("ownedOnly") ?? "").toLowerCase(),
    );

    /* -------- STEP 1 – product IDs with proper limit/offset ----- */
    let idQuery = db
      .selectFrom("products")
      .select("id")
      .where("organizationId", "=", organizationId)
      .where("tenantId", "=", tenantId);

    if (search) {
      idQuery = idQuery.where((eb) =>
        eb.or([
          eb("title", "ilike", `%${search}%` as any),
          eb("sku", "ilike", `%${search}%` as any),
          eb.exists(
            db
              .selectFrom("productVariations as v")
              .select("v.id")
              .whereRef("v.productId", "=", "products.id")
              .where("v.sku", "ilike", `%${search}%` as any),
          ),
        ]),
      );
    }

    if (categoryId)
      idQuery = idQuery.where(
        "id",
        "in",
        db
          .selectFrom("productCategory")
          .select("productId")
          .where("categoryId", "=", categoryId),
      );

    if (status) idQuery = idQuery.where("status", "=", status);

    if (ownedOnly) {
      idQuery = idQuery.where((eb) =>
        eb.or([eb("sku", "is", null), eb("sku", "not ilike", "SHD%")]),
      );
    }

    let idRows: Array<{ id: string }>;

    if (attributeTermId) {
      // JOIN path so filtering happens BEFORE LIMIT/OFFSET
      const jq = db
        .selectFrom("productAttributeValues as pav")
        .innerJoin("products as p", "p.id", "pav.productId")
        .select("p.id")
        .where("p.organizationId", "=", organizationId)
        .where("p.tenantId", "=", tenantId)
        .where("pav.termId", "=", attributeTermId)
        .$if(Boolean(search), (q) =>
          q.where((eb) =>
            eb.or([
              eb("p.title", "ilike", `%${search}%` as any),
              eb("p.sku", "ilike", `%${search}%` as any),
              eb.exists(
                db
                  .selectFrom("productVariations as v")
                  .select("v.id")
                  .whereRef("v.productId", "=", "p.id")
                  .where("v.sku", "ilike", `%${search}%` as any),
              ),
            ]),
          ),
        )
        .$if(Boolean(categoryId), (q) =>
          q.where(
            "p.id",
            "in",
            db
              .selectFrom("productCategory")
              .select("productId")
              .where("categoryId", "=", categoryId),
          ),
        )
        .$if(!!status, (q) => q.where("p.status", "=", status!))
        .$if(ownedOnly, (q) =>
          q.where((eb) =>
            eb.or([eb("p.sku", "is", null), eb("p.sku", "not ilike", "SHD%")]),
          ),
        )
        .groupBy("p.id")
        // Case-insensitive sort for text columns in JOIN path
        .$if(orderBy === "title", (q) =>
          q.orderBy(sql`lower(p.title)`, orderDir as any)
        )
        .$if(orderBy === "sku", (q) =>
          q.orderBy(sql`lower(p.sku)`, orderDir as any)
        )
        .$if(orderBy !== "title" && orderBy !== "sku", (q) =>
          q.orderBy(("p." + orderBy) as any, orderDir)
        )
        .orderBy("p.id", "asc")
        .limit(pageSize)
        .offset((page - 1) * pageSize);

      idRows = await jq.execute();
    } else {
      // No term filter → use the original simple products query
      // Case-insensitive sort for text columns; deterministic tie-break by id.
      if (orderBy === "title") {
        idQuery = idQuery.orderBy(sql`lower(title)`, orderDir as any);
      } else if (orderBy === "sku") {
        idQuery = idQuery.orderBy(sql`lower(sku)`, orderDir as any);
      } else {
        idQuery = idQuery.orderBy(orderBy as any, orderDir);
      }
      idRows = await idQuery
        .orderBy("id", "asc")
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute();
    }

    const productIds = idRows.map((r) => r.id);

    /* return early if empty page */
    if (!productIds.length) {
      return NextResponse.json({
        products: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      });
    }

    /* OPTIONAL: detect shared copies in this page and precompute allowed countries */
    const mappings = await db
      .selectFrom("sharedProductMapping")
      .select(["targetProductId", "sourceProductId", "shareLinkId"])
      .where("targetProductId", "in", productIds)
      .execute();
    const mapByTarget = new Map(mappings.map((m) => [m.targetProductId, m]));
    const shareLinkIds = Array.from(new Set(mappings.map((m) => m.shareLinkId)));
    const sourceIds = Array.from(new Set(mappings.map((m) => m.sourceProductId)));

    let linkCountriesById = new Map<string, string[]>();
    if (shareLinkIds.length) {
      const linkRows = await db
        .selectFrom("warehouseShareLink")
        .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
        .select([
          "warehouseShareLink.id as shareLinkId",
          "warehouse.countries",
        ])
        .where("warehouseShareLink.id", "in", shareLinkIds)
        .execute();
      linkCountriesById = new Map(
        linkRows.map((r) => [
          r.shareLinkId,
          JSON.parse(r.countries as any) as string[],
        ]),
      );
    }
    let sharedRowsByKey = new Map<
      string,
      Array<{ variationId: string | null; cost: any }>
    >();
    if (shareLinkIds.length && sourceIds.length) {
      const rows = await db
        .selectFrom("sharedProduct")
        .select(["shareLinkId", "productId", "variationId", "cost"])
        .where("shareLinkId", "in", shareLinkIds)
        .where("productId", "in", sourceIds)
        .execute();
      for (const r of rows) {
        const k = `${r.shareLinkId}:${r.productId}`;
        (sharedRowsByKey.get(k) ?? sharedRowsByKey.set(k, []).get(k)!).push({
          variationId: r.variationId,
          cost: r.cost,
        });
      }
    }

    /* -------- STEP 2 – core product rows ------------------------ */
    /* -------- STEP 2 – core product rows ------------------------
     NOTE: we DO NOT sort here again by title/sku.
     We preserve the order from STEP 1 using the list of ids. */
    let productRows = await db
      .selectFrom("products")
      .select([
        "id",
        "title",
        "description",
        "image",
        "sku",
        "status",
        "productType",
        "regularPrice",
        "salePrice",
        "cost",
        "allowBackorders",
        "manageStock",
        "stockStatus",
        "createdAt",
        "updatedAt",
      ])
      .where("id", "in", productIds)
      .execute();

    // Preserve STEP 1 order (which already applies pagination + sorting)
    const idOrder = new Map<string, number>(
      productIds.map((id, idx) => [id, idx])
    );
    productRows.sort(
      (a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0)
    );

    /* -------- STEP 3 – related data in bulk --------------------- */
    const stockRows = await db
      .selectFrom("warehouseStock")
      .select(["productId", "variationId", "warehouseId", "country", "quantity"])
      .where("productId", "in", productIds)
      .execute();

    const variationRows = await db
      .selectFrom("productVariations")
      .selectAll()
      .where("productId", "in", productIds)
      .execute();

    const categoryRows = await db
      .selectFrom("productCategory")
      .select(["productCategory.productId", "productCategory.categoryId"])
      .where("productCategory.productId", "in", productIds)
      .execute();

    // 🧭 3.b — Build name maps for attributes and terms used by variations
    const attrIds = new Set<string>();
    const termIds = new Set<string>();

    for (const v of variationRows) {
      const attrs = typeof v.attributes === "string" ? JSON.parse(v.attributes || "{}") : (v.attributes || {});
      for (const [attributeId, termId] of Object.entries(attrs)) {
        if (attributeId) attrIds.add(attributeId);
        if (termId) termIds.add(String(termId));
      }
    }

    const attrNameRows = attrIds.size
      ? await db
        .selectFrom("productAttributes")
        .select(["id", "name"])
        .where("id", "in", Array.from(attrIds))
        .execute()
      : [];

    const termNameRows = termIds.size
      ? await db
        .selectFrom("productAttributeTerms")
        .select(["id", "name"])
        .where("id", "in", Array.from(termIds))
        .execute()
      : [];

    const ATTR_NAME: Record<string, string> = Object.fromEntries(
      attrNameRows.map(r => [r.id, r.name])
    );
    const TERM_NAME: Record<string, string> = Object.fromEntries(
      termNameRows.map(r => [r.id, r.name])
    );

    // little helper
    const getAllowed = (targetId: string): { product: string[] | null; byVar: Map<string, string[]> } => {
      const m = mapByTarget.get(targetId); if (!m) return { product: null, byVar: new Map() };
      const linkList = linkCountriesById.get(m.shareLinkId) || [];
      const k = `${m.shareLinkId}:${m.sourceProductId}`;
      const rows = sharedRowsByKey.get(k) || [];
      const prodRow = rows.find(r => r.variationId === null);
      const prodKeys = Object.keys(parseMap<Record<string, number>>(prodRow?.cost) || {});
      const productAllowed = prodKeys.length ? prodKeys : (linkList.length ? linkList : null);
      const byVar = new Map<string, string[]>();
      for (const r of rows) {
        if (!r.variationId) continue;
        const keys = Object.keys(parseMap<Record<string, number>>(r.cost) || {});
        byVar.set(r.variationId, keys.length ? keys : linkList);
      }
      return { product: productAllowed, byVar };
    };

    /* -------- STEP 4 – assemble final products ------------------ */
    const products = productRows.map((p) => {
      const allowedInfo = getAllowed(p.id);
      const maxNum = (arr: number[]) =>
        arr.length ? Math.max(...arr.map(Number)) : 0;
      const maxOrNull = (arr: number[]) =>
        arr.length ? Math.max(...arr.map(Number)) : null;

      const stockData = stockRows
        .filter((s) => s.productId === p.id && !s.variationId)
        .reduce((acc, s) => {
          if (!acc[s.warehouseId]) acc[s.warehouseId] = {};
          acc[s.warehouseId][s.country] = s.quantity;
          return acc;
        }, {} as Record<string, Record<string, number>>);

      const variations =
        p.productType === "variable"
          ? variationRows
            .filter((v) => v.productId === p.id)
            .map((v) => ({
              id: v.id,
              attributes:
                typeof v.attributes === "string"
                  ? JSON.parse(v.attributes)
                  : v.attributes,
              sku: v.sku,
              image: v.image,
              prices: (() => {
                const vRegRaw = typeof v.regularPrice === "string" ? JSON.parse(v.regularPrice) : v.regularPrice;
                const vSalRaw = typeof v.salePrice === "string" ? JSON.parse(v.salePrice) : v.salePrice;
                const allowedForVar =
                  allowedInfo.byVar.get(v.id) || allowedInfo.product || null;
                const vReg = allowedForVar ? (pickKeys(vRegRaw, allowedForVar) || {}) : vRegRaw;
                const vSal = allowedForVar ? pickKeys(vSalRaw, allowedForVar) : vSalRaw;
                return mergePriceMaps(vReg, vSal);
              })(),
              cost: (() => {
                const raw = typeof v.cost === "string" ? JSON.parse(v.cost) : v.cost;
                const allowedForVar = allowedInfo.byVar.get(v.id) || allowedInfo.product || null;
                return allowedForVar ? (pickKeys(raw, allowedForVar) || {}) : raw;
              })(),
              stock: stockRows
                .filter((s) => s.variationId === v.id)
                .reduce((acc, s) => {
                  if (!acc[s.warehouseId]) acc[s.warehouseId] = {};
                  acc[s.warehouseId][s.country] = s.quantity;
                  return acc;
                }, {} as Record<string, Record<string, number>>),
            }))
          : [];

      /* recompute stockStatus */
      let computedStatus = p.stockStatus;
      if (p.manageStock) {
        if (p.productType === "variable") {
          computedStatus = variations.some(
            (v) => Object.keys(v.stock).length
          )
            ? "managed"
            : "unmanaged";
        } else {
          computedStatus = Object.keys(stockData).length
            ? "managed"
            : "unmanaged";
        }
      }

      // price maps (filtered for shared copies)
      const prodRegularRaw =
        typeof p.regularPrice === "string" ? JSON.parse(p.regularPrice || "{}") : p.regularPrice || {};
      const prodSaleRaw =
        typeof p.salePrice === "string" ? JSON.parse(p.salePrice || "null") : p.salePrice ?? null;

      const prodRegular = allowedInfo.product ? (pickKeys(prodRegularRaw, allowedInfo.product) || {}) : prodRegularRaw;
      const prodSale = allowedInfo.product ? pickKeys(prodSaleRaw, allowedInfo.product) : prodSaleRaw;


      let maxRegularPrice = 0;
      let maxSalePrice: number | null = null;

      if (p.productType === "simple") {
        maxRegularPrice = maxNum(Object.values(prodRegular || {}));
        maxSalePrice = prodSale ? maxOrNull(Object.values(prodSale)) : null;
      } else {
        const varMaxRegs: number[] = [];
        const varMaxSales: number[] = [];
        for (const v of variations) {
          const regs = Object.values(v.prices || {}).map(
            (pr) => pr.regular ?? 0
          );
          const sales = Object.values(v.prices || {})
            .map((pr) => pr.sale)
            .filter((x): x is number => x != null);
          if (regs.length) varMaxRegs.push(Math.max(...regs));
          if (sales.length) varMaxSales.push(Math.max(...sales));
        }
        maxRegularPrice = varMaxRegs.length ? Math.max(...varMaxRegs) : 0;
        maxSalePrice = varMaxSales.length ? Math.max(...varMaxSales) : null;
      }

      return {
        id: p.id,
        title: p.title,
        description: p.description,
        image: p.image,
        sku: p.sku,
        status: p.status,
        productType: p.productType,
        regularPrice: prodRegular,
        salePrice: prodSale,
        maxRegularPrice,
        maxSalePrice,
        cost: typeof p.cost === "string" ? JSON.parse(p.cost) : p.cost,
        allowBackorders: p.allowBackorders,
        manageStock: p.manageStock,
        stockStatus: computedStatus,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        stockData,
        categories: categoryRows
          .filter((c) => c.productId === p.id)
          .map((c) => c.categoryId),
        attributes: [],
        variations,
      };
    });

    // ✅ productsFlat: include variationId; keep id = original productId
    function splitVarPrices(
      prices: Record<string, { regular: number; sale: number | null }>
    ) {
      const regular: Record<string, number> = {};
      const sale: Record<string, number> | null = Object.create(null);
      let hasSale = false;

      for (const [ct, pr] of Object.entries(prices || {})) {
        regular[ct] = Number(pr?.regular ?? 0);
        if (pr?.sale != null) {
          if (sale) (sale as any)[ct] = Number(pr.sale);
          hasSale = true;
        }
      }
      return { regular, sale: hasSale ? (sale as Record<string, number>) : null };
    }

    const maxNum = (vals: number[]) =>
      vals.length ? Math.max(...vals.map(Number)) : 0;
    const maxOrNull = (vals: number[]) =>
      vals.length ? Math.max(...vals.map(Number)) : null;

    const productsFlat = products.flatMap((p) => {
      if (p.productType !== "variable") {
        // Simple product: keep id as productId and add variationId=null
        return [{
          id: p.id,
          productId: p.id,
          variationId: null,
          title: p.title,
          description: p.description,
          image: p.image,
          sku: p.sku,
          status: p.status,
          productType: "simple" as const,
          regularPrice: p.regularPrice,
          salePrice: p.salePrice,
          maxRegularPrice: p.maxRegularPrice,
          maxSalePrice: p.maxSalePrice,
          cost: p.cost ?? {},
          allowBackorders: p.allowBackorders,
          manageStock: p.manageStock,
          stockStatus: p.stockStatus,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          stockData: p.stockData,
          categories: p.categories,
          attributes: [],
          variations: [],
        }];
      }

      // Variable: one row per variation with id=productId, variationId=<var id>
      return (p.variations || []).map((v) => {
        const { regular, sale } = splitVarPrices(v.prices || {});
        const maxRegularPrice = maxNum(Object.values(regular));
        const maxSalePrice = sale ? maxOrNull(Object.values(sale)) : null;

        const pairs = Object.entries(v.attributes || {});
        const variantLabel = pairs
          .map(([attrId, termId]) => `${ATTR_NAME[attrId] ?? attrId} ${TERM_NAME[String(termId)] ?? termId}`)
          .join(", ");
        const titleWithVariant = variantLabel ? `${p.title} - ${variantLabel}` : p.title;

        const stockData = v.stock || {};
        const manageStock = Boolean(p.manageStock);
        const stockStatus = manageStock && Object.keys(stockData).length ? "managed" : "unmanaged";

        return {
          id: p.id,                 // keep original productId here
          productId: p.id,          // explicit parent id
          variationId: v.id,        // explicit variation id
          title: titleWithVariant,
          description: p.description,
          image: v.image ?? p.image,
          sku: v.sku,
          status: p.status,
          productType: "simple" as const,
          regularPrice: regular,
          salePrice: sale,
          maxRegularPrice,
          maxSalePrice,
          cost: v.cost ?? {},
          allowBackorders: p.allowBackorders,
          manageStock,
          stockStatus,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          stockData,
          categories: p.categories,
          attributes: [],
          variations: [],
        };
      });
    });

    /* -------- STEP 5 – total count ------------------------------ */
    let total = 0;

    if (attributeTermId) {
      // Count DISTINCT product IDs using a subquery (mirrors the ID JOIN branch)
      const sub = db
        .selectFrom("productAttributeValues as pav")
        .innerJoin("products as p", "p.id", "pav.productId")
        .select("p.id")
        .where("p.organizationId", "=", organizationId)
        .where("p.tenantId", "=", tenantId)
        .where("pav.termId", "=", attributeTermId)
        .$if(Boolean(search), (q) =>
          q.where((eb) =>
            eb.or([
              eb("p.title", "ilike", `%${search}%` as any),
              eb("p.sku", "ilike", `%${search}%` as any),
              eb.exists(
                db
                  .selectFrom("productVariations as v")
                  .select("v.id")
                  .whereRef("v.productId", "=", "p.id")
                  .where("v.sku", "ilike", `%${search}%` as any)
              ),
            ])
          )
        )
        .$if(Boolean(categoryId), (q) =>
          q.where(
            "p.id",
            "in",
            db
              .selectFrom("productCategory")
              .select("productId")
              .where("categoryId", "=", categoryId)
          )
        )
        .$if(!!status, (q) => q.where("p.status", "=", status!))
        // ⬇️ ownedOnly in the count JOIN branch
        .$if(ownedOnly, (q) =>
          q.where((eb) =>
            eb.or([eb("p.sku", "is", null), eb("p.sku", "not ilike", "SHD%")])
          )
        )
        .groupBy("p.id")
        .as("t");

      const totalJoin = await db
        .selectFrom(sub)
        .select(db.fn.countAll<number>().as("total"))
        .executeTakeFirst();

      total = Number(totalJoin?.total ?? 0);
    } else {
      // Simple count on products (no term filter)
      const totalPlain = await db
        .selectFrom("products")
        .select(db.fn.countAll<number>().as("total"))
        .where("organizationId", "=", organizationId)
        .where("tenantId", "=", tenantId)
        .$if(Boolean(search), (q) =>
          q.where((eb) =>
            eb.or([
              eb("title", "ilike", `%${search}%` as any),
              eb("sku", "ilike", `%${search}%` as any),
              eb.exists(
                db
                  .selectFrom("productVariations as v")
                  .select("v.id")
                  .whereRef("v.productId", "=", "products.id")
                  .where("v.sku", "ilike", `%${search}%` as any)
              ),
            ])
          )
        )
        .$if(Boolean(categoryId), (q) =>
          q.where(
            "id",
            "in",
            db
              .selectFrom("productCategory")
              .select("productId")
              .where("categoryId", "=", categoryId)
          )
        )
        .$if(!!status, (q) => q.where("status", "=", status!))
        // ⬇️ ownedOnly in the simple count branch
        .$if(ownedOnly, (q) =>
          q.where((eb) =>
            eb.or([eb("sku", "is", null), eb("sku", "not ilike", "SHD%")])
          )
        )
        .executeTakeFirst();

      total = Number(totalPlain?.total ?? 0);
    }

    return NextResponse.json({
      products,
      productsFlat, // <-- now has id = productId and a variationId field
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("[PRODUCTS_GET]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}


/* helper: merge regular/sale JSON objects ➜ { IT:{regular, sale}, …} */
function mergePriceMaps(
  regular: Record<string, number> | null,
  sale: Record<string, number> | null,
) {
  const map: Record<string, { regular: number; sale: number | null }> = {};
  const reg = regular || {};
  const sal = sale || {};
  for (const [c, v] of Object.entries(reg))
    map[c] = { regular: Number(v), sale: null };
  for (const [c, v] of Object.entries(sal))
    map[c] = { ...(map[c] || { regular: 0, sale: null }), sale: Number(v) };
  return map;
}


/* ------------------------------------------------------------------ */
/*  POST                                                              */
/* ------------------------------------------------------------------ */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId, tenantId } = ctx;

  /* ----------  main logic  --------------------------------------- */
  try {
    const body = await req.json()
    let parsedProduct = productSchema.parse(body)

    /* SKU handling */
    let finalSku = parsedProduct.sku
    if (!finalSku) {
      do {
        finalSku = `SKU-${uuidv4().slice(0, 8)}`
      } while (await db.selectFrom("products").select("id")
        .where("sku", "=", finalSku)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst())
    } else {
      const exists = await db.selectFrom("products").select("id")
        .where("sku", "=", finalSku)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst()
      if (exists) return NextResponse.json({ error: "SKU already exists" }, { status: 400 })
    }
    parsedProduct = { ...parsedProduct, sku: finalSku }

    /* category validation */
    if (parsedProduct.categories?.length) {
      const validIds = (await db.selectFrom("productCategories")
        .select("id")
        .where("organizationId", "=", organizationId)
        .execute()).map(c => c.id)
      const bad = parsedProduct.categories.filter(id => !validIds.includes(id))
      if (bad.length)
        return NextResponse.json({ error: `Invalid category IDs: ${bad.join(", ")}` }, { status: 400 })
    }


    let regularPrice: Record<string, number> = {};
    let salePrice: Record<string, number> | null = null;
    if (parsedProduct.productType === "simple") {
      const maps = splitPrices(parsedProduct.prices ?? {});
      regularPrice = maps.regularPrice;
      salePrice = maps.salePrice;
    }

    const productId = uuidv4()

    /* Compute stockStatus */
    let stockStatus = parsedProduct.manageStock ? "managed" : "unmanaged"
    if (parsedProduct.productType === "variable" && parsedProduct.warehouseStock?.some(ws => ws.variationId)) {
      stockStatus = "managed"
    }

    await db.insertInto("products").values({
      id: productId,
      organizationId,
      tenantId,
      title: parsedProduct.title,
      description: parsedProduct.description || null,
      image: parsedProduct.image || null,
      sku: parsedProduct.sku,
      status: parsedProduct.status,
      productType: parsedProduct.productType,
      regularPrice,
      salePrice,
      cost: parsedProduct.cost ?? {},
      allowBackorders: parsedProduct.allowBackorders,
      manageStock: parsedProduct.manageStock,
      stockStatus,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).execute()

    /* variations */
    if (parsedProduct.productType === "variable" && parsedProduct.variations?.length) {
      for (const v of parsedProduct.variations) {
        const { regularPrice, salePrice } = splitPrices(v.prices)
        await db.insertInto("productVariations").values({
          id: v.id,
          productId,
          attributes: v.attributes,
          sku: v.sku,
          image: v.image ?? null,
          regularPrice,
          salePrice,
          cost: v.cost ?? {},
          createdAt: new Date(),
          updatedAt: new Date(),
        }).execute()
      }
      // 🧩 If the client did not send attributes, derive productAttributeValues from variations
      if (!parsedProduct.attributes?.length) {
        const attrToTerms = new Map<string, Set<string>>();
        for (const v of parsedProduct.variations) {
          for (const [attrId, termId] of Object.entries(v.attributes || {})) {
            if (!attrId || !termId) continue;
            (attrToTerms.get(attrId) ?? attrToTerms.set(attrId, new Set()).get(attrId)!).add(String(termId));
          }
        }
        for (const [attributeId, termSet] of attrToTerms.entries()) {
          for (const termId of termSet) {
            await db.insertInto("productAttributeValues")
              .values({ productId, attributeId, termId })
              .execute();
          }
        }
      }
    }



    /* insert warehouseStock entries */
    if (parsedProduct.warehouseStock?.length) {
      for (const entry of parsedProduct.warehouseStock) {
        /* after */
        await db.insertInto("warehouseStock").values({
          id: uuidv4(),
          warehouseId: entry.warehouseId,
          productId,                        // ← use the local const `productId`
          variationId: entry.variationId,
          country: entry.country,
          quantity: entry.quantity,
          organizationId,
          tenantId,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).execute()
      }
    }

    /* attribute & category relations */
    if (parsedProduct.attributes?.length) {
      for (const a of parsedProduct.attributes)
        for (const termId of a.selectedTerms)
          await db.insertInto("productAttributeValues")
            .values({ productId, attributeId: a.id, termId })
            .execute()
    }
    if (parsedProduct.categories?.length) {
      for (const cid of parsedProduct.categories)
        await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
    }

    return NextResponse.json({
      product: {
        id: productId, ...parsedProduct, cost: parsedProduct.cost ?? {}, organizationId, tenantId,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    }, { status: 201 })
  } catch (err) {
    console.error("[PRODUCTS_POST]", err)
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 })
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

/* ------------------------------------------------------------------ */
/*  DELETE – bulk delete                                              */
/* ------------------------------------------------------------------ */
export async function DELETE(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "No product IDs provided" },
        { status: 400 }
      );
    }

    // verify ownership
    const valid = await db
      .selectFrom("products")
      .select("id")
      .where("id", "in", ids)
      .where("organizationId", "=", organizationId)
      .execute();
    const validIds = valid.map((r) => r.id);
    if (validIds.length !== ids.length) {
      return NextResponse.json(
        { error: "Some products not found or unauthorized" },
        { status: 404 }
      );
    }

    // cascade‐delete all selected products in one go
    await propagateDeleteDeep(db, validIds);

    return NextResponse.json({
      message: `Deleted ${validIds.length} product(s)`,
    });
  } catch (err) {
    console.error("[PRODUCTS_BULK_DELETE]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
