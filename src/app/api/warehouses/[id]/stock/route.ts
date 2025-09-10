// src/app/api/warehouses/[id]/stock/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { sql } from "kysely";
import { propagateStockDeep } from "@/lib/propagate-stock";
import { getContext } from "@/lib/context";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

/* ────────────────────────────────────────────────────────────── */
/*  ZOD – incoming stock-update payload                           */
/* ────────────────────────────────────────────────────────────── */
const stockUpdateSchema = z.array(
  z.object({
    productId: z.string(),
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);
type StockUpdate = z.infer<typeof stockUpdateSchema>[number];

/* ────────────────────────────────────────────────────────────── */
/*  helpers                                                      */
/* ────────────────────────────────────────────────────────────── */
function generateId(prefix = "WS"): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

/* tolerate JSON columns that may already be objects */
function safeParseJSON<T = any>(value: unknown): T {
  if (value == null) return {} as T;
  if (typeof value === "string") {
    try { return JSON.parse(value) as T; } catch { return {} as T; }
  }
  return value as T;
}

function attrLabel(
  attrs: Record<string, string>,
  termMap: Map<string, string>,
): string {
  return Object.values(attrs)
    .map((tid) => termMap.get(tid) ?? tid)
    .join(" / ");
}

/* ────────────────────────────────────────────────────────────── */
/*  GET  – list stock items for a warehouse                       */
/* ────────────────────────────────────────────────────────────── */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const internalSecret = req.headers.get("x-internal-secret");

    // Require context unless internal secret is provided
    let tenantCtx: { tenantId: string } | null = null;
    if (internalSecret !== INTERNAL_API_SECRET) {
      const maybe = await getContext(req);
      if (maybe instanceof NextResponse) return maybe;
      tenantCtx = { tenantId: maybe.tenantId };
    }

    const { id: warehouseId } = await ctx.params;

    /* ── verify warehouse ownership ───────────────────────────── */
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();

    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    if (tenantCtx && tenantCtx.tenantId !== warehouse.tenantId) {
      return NextResponse.json(
        { error: "Unauthorized: You do not own this warehouse" },
        { status: 403 },
      );
    }

    /* ── 1. money-products query ─────────────────────────────── */
    const moneyRows = await db
      .selectFrom("warehouseStock")
      .innerJoin("products", "products.id", "warehouseStock.productId")
      .leftJoin("productVariations", "productVariations.id", "warehouseStock.variationId")
      .leftJoin("productCategory", "productCategory.productId", "products.id")
      .leftJoin("productCategories", "productCategories.id", "productCategory.categoryId")
      .select([
        "warehouseStock.productId         as pid",
        "warehouseStock.variationId",
        "warehouseStock.country",
        "warehouseStock.quantity",
        "products.title                   as pTitle",
        "products.status                  as pStatus",
        "products.cost                    as pCost",
        "products.productType             as pType",
        "productVariations.cost           as vCost",
        "productVariations.sku            as vSku",
        "productVariations.attributes     as vAttrs",
        "productCategories.id             as catId",
        "productCategories.name           as catName",
      ])
      .where("warehouseStock.warehouseId", "=", warehouseId)
      /*.where("warehouseStock.quantity", ">", 0)*/
      .execute();

    /* ── 2. affiliate-products query ─────────────────────────── */
    const affRows = await db
      .selectFrom("warehouseStock")
      .innerJoin("affiliateProducts", "affiliateProducts.id", "warehouseStock.productId")
      .leftJoin("affiliateProductVariations", "affiliateProductVariations.id", "warehouseStock.variationId")
      .select([
        "warehouseStock.productId         as pid",
        "warehouseStock.variationId",
        "warehouseStock.country",
        "warehouseStock.quantity",
        "affiliateProducts.title                as pTitle",
        "affiliateProducts.status               as pStatus",
        "affiliateProducts.cost                 as pCost",
        "affiliateProducts.productType          as pType",
        "affiliateProductVariations.cost        as vCost",
        "affiliateProductVariations.sku         as vSku",
        "affiliateProductVariations.attributes  as vAttrs",
        sql`NULL`.as("catId"),
        sql`NULL`.as("catName"),
      ])
      .where("warehouseStock.warehouseId", "=", warehouseId)
      /* .where("warehouseStock.quantity", ">", 0) */
      .execute();

    const rows = [...moneyRows, ...affRows];

    /* ── 3. build term-id → name map ─────────────────────────── */
    const termIds = new Set<string>();
    rows.forEach((r) => {
      if (r.vAttrs) {
        const attrs = safeParseJSON<Record<string, string>>(r.vAttrs);
        Object.values(attrs).forEach((tid) => termIds.add(tid));
      }
    });

    const termMap = termIds.size
      ? new Map(
        (
          await db
            .selectFrom("productAttributeTerms")
            .select(["id", "name"])
            .where("id", "in", [...termIds])
            .execute()
        ).map((t) => [t.id, t.name]),
      )
      : new Map<string, string>();

    /* ── 4. transform rows into final payload ─────────────────── */
    const stock = rows.map((r) => {
      const vLabel = r.vAttrs
        ? attrLabel(safeParseJSON<Record<string, string>>(r.vAttrs), termMap)
        : "";

      const mergedCost = r.variationId
        ? safeParseJSON<Record<string, number>>(r.vCost)
        : safeParseJSON<Record<string, number>>(r.pCost);

      return {
        productId: r.pid,
        variationId: r.variationId,
        title: r.variationId ? `${r.pTitle} - ${vLabel || r.vSku}` : r.pTitle,
        status: r.pStatus,
        cost: mergedCost,
        country: r.country,
        quantity: r.quantity,
        productType: r.pType,
        categoryId: r.catId,
        categoryName: r.catName || "Uncategorized",
      };
    });

    return NextResponse.json(
      { stock, countries: safeParseJSON<string[]>(warehouse.countries) },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GET /api/warehouses/[id]/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/* ────────────────────────────────────────────────────────────── */
/*  PATCH  – upsert/propagate stock                               */
/* ────────────────────────────────────────────────────────────── */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const internalSecret = req.headers.get("x-internal-secret");
    let ctxOrNull: { tenantId: string } | null = null;

    if (internalSecret !== INTERNAL_API_SECRET) {
      const maybe = await getContext(req);
      if (maybe instanceof NextResponse) return maybe;
      ctxOrNull = { tenantId: maybe.tenantId };
    }

    const params = await context.params;
    const warehouseId = params.id;

    const body = await req.json();
    const parsed = stockUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const stockUpdates = parsed.data;

    /* ── ownership ─────────────────────────────────────────────── */
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries", "organizationId"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }
    if (ctxOrNull && ctxOrNull.tenantId !== warehouse.tenantId) {
      return NextResponse.json(
        { error: "Unauthorized: You do not own this warehouse" },
        { status: 403 },
      );
    }

    const warehouseCountries = JSON.parse(warehouse.countries) as string[];

    /* ── updates loop ──────────────────────────────────────────── */
    for (const update of stockUpdates) {
      const { productId, variationId, country, quantity } = update;

      if (!warehouseCountries.includes(country)) {
        return NextResponse.json(
          { error: `Country ${country} not supported by warehouse` },
          { status: 400 },
        );
      }

      const moneyProduct = await db
        .selectFrom("products")
        .select(["id", "productType", "tenantId"])
        .where("id", "=", productId)
        .executeTakeFirst();

      const isAffiliate = !moneyProduct;

      const affiliateProduct = isAffiliate
        ? await db
          .selectFrom("affiliateProducts")
          .select(["id", "productType", "tenantId"])
          .where("id", "=", productId)
          .executeTakeFirst()
        : null;

      if (!moneyProduct && !affiliateProduct) {
        return NextResponse.json(
          { error: `Product ${productId} not found` },
          { status: 400 },
        );
      }

      const productType = isAffiliate
        ? (affiliateProduct!.productType as "simple" | "variable")
        : (moneyProduct!.productType as "simple" | "variable");

      const productTenantId = isAffiliate ? affiliateProduct!.tenantId : moneyProduct!.tenantId;

      if (productTenantId !== warehouse.tenantId) {
        return NextResponse.json(
          { error: `Product ${productId} does not belong to your tenant` },
          { status: 403 },
        );
      }

      if (variationId) {
        if (productType !== "variable") {
          return NextResponse.json(
            { error: `Product ${productId} is not variable` },
            { status: 400 },
          );
        }

        const variationExists = isAffiliate
          ? await db
            .selectFrom("affiliateProductVariations")
            .select("id")
            .where("id", "=", variationId)
            .where("productId", "=", productId)
            .executeTakeFirst()
          : await db
            .selectFrom("productVariations")
            .select("id")
            .where("id", "=", variationId)
            .where("productId", "=", productId)
            .executeTakeFirst();

        if (!variationExists) {
          return NextResponse.json(
            { error: `Variation ${variationId} not found` },
            { status: 400 },
          );
        }
      }

      /* upsert */
      let stockQuery = db
        .selectFrom("warehouseStock")
        .select("id")
        .where("warehouseId", "=", warehouseId)
        .where("productId", "=", productId)
        .where("country", "=", country);

      stockQuery = variationId
        ? stockQuery.where("variationId", "=", variationId)
        : stockQuery.where("variationId", "is", null);

      const existingStock = await stockQuery.executeTakeFirst();

      if (existingStock) {
        await db
          .updateTable("warehouseStock")
          .set({ quantity, updatedAt: new Date() })
          .where("id", "=", existingStock.id)
          .execute();
      } else {
        await db
          .insertInto("warehouseStock")
          .values({
            id: generateId("WS"),
            warehouseId,
            productId,
            variationId,
            country,
            quantity,
            organizationId: warehouse.organizationId,
            tenantId: warehouse.tenantId,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }
    }

    /* ── propagation (unchanged semantics; money products only) ── */
    const updatesByProduct: Record<string, StockUpdate[]> = {};
    for (const u of stockUpdates) (updatesByProduct[u.productId] ??= []).push(u);

    const nextProductIds = new Set<string>();

    for (const [productKey, updates] of Object.entries(updatesByProduct)) {
      const normalProductRow = await db
        .selectFrom("products")
        .select("id")
        .where("id", "=", productKey)
        .executeTakeFirst();
      if (!normalProductRow) continue;

      const sharedProducts = await db
        .selectFrom("sharedProduct")
        .select(["id", "shareLinkId"])
        .where("productId", "=", productKey)
        .execute();

      if (!sharedProducts.length) continue;

      const mappings = await db
        .selectFrom("sharedProductMapping")
        .select(["id", "sourceProductId", "targetProductId", "shareLinkId"])
        .where("sourceProductId", "=", productKey)
        .where("shareLinkId", "in", sharedProducts.map((sp) => sp.shareLinkId))
        .execute();

      if (!mappings.length) continue;

      const mappingsByTarget: Record<string, { sourceProductId: string; shareLinkId: string }[]> = {};
      for (const m of mappings) {
        (mappingsByTarget[m.targetProductId] ??= []).push({
          sourceProductId: m.sourceProductId,
          shareLinkId: m.shareLinkId,
        });
      }

      for (const [targetProductId, targetMappings] of Object.entries(mappingsByTarget)) {
        const shareLinkRecipient = await db
          .selectFrom("warehouseShareRecipient")
          .select("recipientUserId")
          .where("shareLinkId", "in", targetMappings.map((m) => m.shareLinkId))
          .executeTakeFirst();

        if (!shareLinkRecipient) continue;

        const recipientUserId = shareLinkRecipient.recipientUserId;

        const recipientTenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", recipientUserId)
          .executeTakeFirst();

        if (!recipientTenant) continue;

        const recipientTenantId = recipientTenant.id;

        const targetWarehouses = await db
          .selectFrom("warehouse")
          .select(["id", "tenantId"])
          .where("tenantId", "=", recipientTenantId)
          .execute();

        if (!targetWarehouses.length) continue;

        for (const targetWarehouse of targetWarehouses) {
          const recipientMembership = await db
            .selectFrom("member")
            .select("organizationId")
            .where("userId", "=", recipientUserId)
            .executeTakeFirst();

          if (!recipientMembership) continue;

          const recipientOrganizationId = recipientMembership.organizationId;

          const stockUpdatesByKey: Record<
            string,
            { quantity: number; variationId: string | null; country: string }
          > = {};

          for (const update of updates) {
            const { variationId, country, quantity } = update;
            const key = `${variationId || "no-variation"}:${country}`;
            if (!stockUpdatesByKey[key]) {
              stockUpdatesByKey[key] = { quantity: 0, variationId, country };
            }
            stockUpdatesByKey[key].quantity += quantity;
          }

          for (const [, { variationId, country }] of Object.entries(stockUpdatesByKey)) {
            const actualVariationId = variationId === "no-variation" ? null : variationId;

            const allSourceMappings = await db
              .selectFrom("sharedProductMapping")
              .innerJoin("warehouseShareLink", "warehouseShareLink.id", "sharedProductMapping.shareLinkId")
              .innerJoin("warehouseShareRecipient", "warehouseShareRecipient.shareLinkId", "warehouseShareLink.id")
              .select(["warehouseShareLink.warehouseId"])
              .where("sharedProductMapping.targetProductId", "=", targetProductId)
              .where(
                "warehouseShareRecipient.shareLinkId",
                "in",
                targetMappings.map((m) => m.shareLinkId),
              )
              .execute();

            const sourceWarehouseIds = allSourceMappings.map((m) => m.warehouseId);
            if (!sourceWarehouseIds.length) continue;

            let sourceStockQuery = db
              .selectFrom("warehouseStock")
              .select(["quantity"])
              .where("productId", "=", productKey)
              .where("country", "=", country)
              .where("warehouseId", "in", sourceWarehouseIds);

            sourceStockQuery = actualVariationId
              ? sourceStockQuery.where("variationId", "=", actualVariationId)
              : sourceStockQuery.where("variationId", "is", null);

            const sourceStocks = await sourceStockQuery.execute();
            const totalQuantity = sourceStocks.reduce((sum, s) => sum + s.quantity, 0);

            let targetVariationId: string | null = null;
            if (actualVariationId) {
              const variationMapping = await db
                .selectFrom("sharedVariationMapping")
                .select("targetVariationId")
                .where("shareLinkId", "in", targetMappings.map((m) => m.shareLinkId))
                .where("sourceProductId", "=", productKey)
                .where("targetProductId", "=", targetProductId)
                .where("sourceVariationId", "=", actualVariationId)
                .executeTakeFirst();
              if (!variationMapping) continue;
              targetVariationId = variationMapping.targetVariationId;
            }

            let targetStockQuery = db
              .selectFrom("warehouseStock")
              .select(["id"])
              .where("productId", "=", targetProductId)
              .where("warehouseId", "=", targetWarehouse.id)
              .where("country", "=", country);

            targetStockQuery = targetVariationId
              ? targetStockQuery.where("variationId", "=", targetVariationId)
              : targetStockQuery.where("variationId", "is", null);

            const targetStock = await targetStockQuery.executeTakeFirst();

            if (targetStock) {
              await db
                .updateTable("warehouseStock")
                .set({ quantity: totalQuantity, updatedAt: new Date() })
                .where("id", "=", targetStock.id)
                .execute();
            } else {
              await db
                .insertInto("warehouseStock")
                .values({
                  id: generateId("WS"),
                  warehouseId: targetWarehouse.id,
                  productId: targetProductId,
                  variationId: targetVariationId,
                  country,
                  quantity: totalQuantity,
                  organizationId: recipientOrganizationId,
                  tenantId: targetWarehouse.tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .execute();
            }
          }
        }
        nextProductIds.add(targetProductId);
      }
    }

    if (nextProductIds.size) {
      await propagateStockDeep(db, [...nextProductIds], generateId);
    }

    return NextResponse.json({ message: "Stock updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/warehouses/[id]/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
