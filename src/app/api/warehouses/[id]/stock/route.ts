// /home/zodx/Desktop/trapigram/src/app/api/warehouses/[id]/stock/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// Schema for stock update request
const stockUpdateSchema = z.array(
  z.object({
    productId: z.string(),
    variationId: z.string().nullable(),
    country: z.string(),
    quantity: z.number().min(0),
  }),
);

// Helper to generate string-based IDs
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

/* ▶ NEW: tolerate JSON columns that arrive as objects */
function safeParseJSON<T = any>(value: unknown): T {
  if (value == null) return {} as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return {} as T;
    }
  }
  return value as T;
}

function attrLabel(attrs: Record<string, string>, termMap: Map<string, string>) {
  return Object.values(attrs)
    .map((tid) => termMap.get(tid) ?? tid)
    .join(" / ");
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    const internalSecret = req.headers.get("x-internal-secret");

    if (!session && internalSecret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const warehouseId = params.id;

    // Validate warehouse exists and user has access
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();

    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    if (session) {
      const tenant = await db
        .selectFrom("tenant")
        .select("id")
        .where("ownerUserId", "=", session.user.id)
        .executeTakeFirst();
      if (!tenant || tenant.id !== warehouse.tenantId) {
        return NextResponse.json(
          { error: "Unauthorized: You do not own this warehouse" },
          { status: 403 },
        );
      }
    }

    // Fetch stock with product, variation, and category details
    const stock = await db
      .selectFrom("warehouseStock")
      .innerJoin("products", "products.id", "warehouseStock.productId")
      .leftJoin("productVariations", "productVariations.id", "warehouseStock.variationId")
      .leftJoin("productCategory", "productCategory.productId", "products.id")
      .leftJoin("productCategories", "productCategories.id", "productCategory.categoryId")
      .select([
        "warehouseStock.id",
        "warehouseStock.productId",
        "warehouseStock.variationId",
        "warehouseStock.country",
        "warehouseStock.quantity",
        "products.title",
        "products.cost as productCost",
        "products.productType",
        "productCategories.id as categoryId",
        "productCategories.name as categoryName",
        /* keep existing columns */
        "productVariations.cost as variationCost",
        "productVariations.sku as variationSku",
        "productVariations.attributes as variationAttributes",
      ])
      .where("warehouseStock.warehouseId", "=", warehouseId)
      .where("warehouseStock.quantity", ">", 0)
      .execute();

    const warehouseCountries = JSON.parse(warehouse.countries) as string[];

    /* ------------------------------------------------------------------ */
    /* build one termId → name map (safe JSON parse)                      */
    /* ------------------------------------------------------------------ */
    const termIds = new Set<string>();
    stock.forEach((r) => {
      if (r.variationAttributes) {
        /* ▶ FIX: use safeParseJSON instead of JSON.parse */
        const attrs = safeParseJSON<Record<string, string>>(r.variationAttributes);
        Object.values(attrs).forEach((tid) => termIds.add(tid));
      }
    });

    const termMap =
      termIds.size > 0
        ? new Map(
            (
              await db
                .selectFrom("productAttributeTerms")
                .select(["id", "name"])
                .where("id", "in", [...termIds])
                .execute()
            ).map((t) => [t.id, t.name]),
          )
        : new Map();

    // Transform stock data
    const stockItems = stock.map((item) => {
      /* decide the variation label */
      let niceVariationLabel = item.variationSku;
      if (item.variationAttributes) {
        /* ▶ FIX: safeParseJSON again */
        const parsed = safeParseJSON<Record<string, string>>(item.variationAttributes);
        const lbl = attrLabel(parsed, termMap);
        if (lbl) niceVariationLabel = lbl;
      }

      return {
        productId: item.productId,
        variationId: item.variationId,
        /* NEW title logic */
        title: item.variationId ? `${item.title} - ${niceVariationLabel}` : item.title,
        cost: item.variationId
          ? typeof item.variationCost === "string"
            ? JSON.parse(item.variationCost)
            : item.variationCost
          : typeof item.productCost === "string"
          ? JSON.parse(item.productCost)
          : item.productCost,
        country: item.country,
        quantity: item.quantity,
        productType: item.productType,
        categoryId: item.categoryId,
        categoryName: item.categoryName || "Uncategorized",
      };
    });

    return NextResponse.json(
      { stock: stockItems, countries: warehouseCountries },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GET /api/warehouses/[id]/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    const internalSecret = req.headers.get("x-internal-secret");

    if (!session && internalSecret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const params = await context.params;
    const warehouseId = params.id;

    const body = await req.json();
    const parsed = stockUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const stockUpdates = parsed.data;

    // Validate warehouse exists and user has access
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries", "organizationId"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    if (session) {
      const tenant = await db
        .selectFrom("tenant")
        .select("id")
        .where("ownerUserId", "=", session.user.id)
        .executeTakeFirst();
      if (!tenant || tenant.id !== warehouse.tenantId) {
        return NextResponse.json({ error: "Unauthorized: You do not own this warehouse" }, { status: 403 });
      }
    }

    const warehouseCountries = JSON.parse(warehouse.countries) as string[];

    // Validate stock updates and update User A's stock
    for (const update of stockUpdates) {
      const { productId, variationId, country, quantity } = update;

      // Validate country
      if (!warehouseCountries.includes(country)) {
        return NextResponse.json({ error: `Country ${country} not supported by warehouse` }, { status: 400 });
      }

      // Validate product exists
      const product = await db
        .selectFrom("products")
        .select(["id", "productType", "tenantId"])
        .where("id", "=", productId)
        .executeTakeFirst();
      if (!product) {
        return NextResponse.json({ error: `Product ${productId} not found` }, { status: 400 });
      }
      if (product.tenantId !== warehouse.tenantId) {
        return NextResponse.json({ error: `Product ${productId} does not belong to your tenant` }, { status: 403 });
      }

      // Validate variation if provided
      if (variationId) {
        if (product.productType !== "variable") {
          return NextResponse.json({ error: `Product ${productId} is not variable` }, { status: 400 });
        }
        const variation = await db
          .selectFrom("productVariations")
          .select("id")
          .where("id", "=", variationId)
          .where("productId", "=", productId)
          .executeTakeFirst();
        if (!variation) {
          return NextResponse.json({ error: `Variation ${variationId} not found` }, { status: 400 });
        }
      }

      // Update or insert stock for User A
      let stockQuery = db
        .selectFrom("warehouseStock")
        .select("id")
        .where("warehouseId", "=", warehouseId)
        .where("productId", "=", productId)
        .where("country", "=", country);

      if (variationId) {
        stockQuery = stockQuery.where("variationId", "=", variationId);
      } else {
        stockQuery = stockQuery.where("variationId", "is", null);
      }

      const existingStock = await stockQuery.executeTakeFirst();

      if (existingStock) {
        await db
          .updateTable("warehouseStock")
          .set({
            quantity,
            updatedAt: new Date(),
          })
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

    // Step 1: Group stock updates by productId, variationId, and country
    const updatesByProduct: Record<
      string,
      { productId: string; variationId: string | null; country: string; quantity: number }[]
    > = {};

    for (const update of stockUpdates) {
      const { productId, variationId, country, quantity } = update;
      const productKey = `${productId}`;
      if (!updatesByProduct[productKey]) {
        updatesByProduct[productKey] = [];
      }
      updatesByProduct[productKey].push({ productId, variationId, country, quantity });
    }

    // Step 2: Process each product
    for (const [productKey, updates] of Object.entries(updatesByProduct)) {
      const productId = updates[0].productId;

      // Step 3: Find all share links that include this product
      let sharedProductQuery = db
        .selectFrom("sharedProduct")
        .select(["id", "shareLinkId"])
        .where("productId", "=", productId);

      const sharedProducts = await sharedProductQuery.execute();

      if (sharedProducts.length === 0) {
        console.log(`[PROPAGATE] No sharedProduct entries found for productId: ${productId}`);
        continue;
      }

      console.log(`[PROPAGATE] Found ${sharedProducts.length} sharedProduct entries for productId: ${productId}`);

      // Step 4: Find all mappings for this product across all share links
      const mappings = await db
        .selectFrom("sharedProductMapping")
        .select(["id", "sourceProductId", "targetProductId", "shareLinkId"])
        .where("sourceProductId", "=", productId)
        .where("shareLinkId", "in", sharedProducts.map(sp => sp.shareLinkId))
        .execute();

      if (mappings.length === 0) {
        console.log(`[PROPAGATE] No mappings found for sourceProductId: ${productId}`);
        continue;
      }

      // Group mappings by targetProductId to process each unique target product
      const mappingsByTarget: Record<string, { sourceProductId: string; shareLinkId: string }[]> = {};
      for (const mapping of mappings) {
        if (!mappingsByTarget[mapping.targetProductId]) {
          mappingsByTarget[mapping.targetProductId] = [];
        }
        mappingsByTarget[mapping.targetProductId].push({
          sourceProductId: mapping.sourceProductId,
          shareLinkId: mapping.shareLinkId,
        });
      }

      // Step 5: Process each target product
      for (const [targetProductId, targetMappings] of Object.entries(mappingsByTarget)) {
        console.log(`[PROPAGATE] Processing targetProductId: ${targetProductId}`);

        // Find the recipient user ID from the share link
        const shareLinkRecipient = await db
          .selectFrom("warehouseShareRecipient")
          .select("recipientUserId")
          .where("shareLinkId", "in", targetMappings.map(m => m.shareLinkId))
          .executeTakeFirst();

        if (!shareLinkRecipient) {
          console.log(`[PROPAGATE] No recipient found for shareLinkIds: ${targetMappings.map(m => m.shareLinkId).join(", ")}`);
          continue;
        }

        const recipientUserId = shareLinkRecipient.recipientUserId;

        // Fetch the recipient's tenant ID
        const recipientTenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", recipientUserId)
          .executeTakeFirst();

        if (!recipientTenant) {
          console.log(`[PROPAGATE] No tenant found for recipientUserId: ${recipientUserId}`);
          continue;
        }

        const recipientTenantId = recipientTenant.id;

        // Fetch all target warehouses for the recipient's tenant
        const targetWarehouses = await db
          .selectFrom("warehouse")
          .select(["id", "tenantId"])
          .where("tenantId", "=", recipientTenantId)
          .execute();

        if (targetWarehouses.length === 0) {
          console.log(`[PROPAGATE] No target warehouses found for targetProductId: ${targetProductId} in tenant ${recipientTenantId}`);
          continue;
        }

        console.log(`[PROPAGATE] Found ${targetWarehouses.length} target warehouses for targetProductId: ${targetProductId} in tenant ${recipientTenantId}`);

        for (const targetWarehouse of targetWarehouses) {
          // Fetch User B's organizationId using recipientUserId
          const recipientMembership = await db
            .selectFrom("member")
            .select("organizationId")
            .where("userId", "=", recipientUserId)
            .executeTakeFirst();

          if (!recipientMembership) {
            console.log(`[PROPAGATE] No membership found for recipientUserId: ${recipientUserId}, skipping`);
            continue;
          }

          const recipientOrganizationId = recipientMembership.organizationId;

          console.log(`[PROPAGATE] Target warehouse found - warehouseId: ${targetWarehouse.id}, tenantId: ${targetWarehouse.tenantId}`);

          // Step 6: Group updates by variationId and country for aggregation
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

          // Step 7: For each variationId and country, aggregate stock from all source warehouses
          for (const [key, { variationId, country, quantity }] of Object.entries(stockUpdatesByKey)) {
            const actualVariationId = variationId === "no-variation" ? null : variationId;

            console.log(
              `[PROPAGATE] Processing stock update for targetProductId: ${targetProductId}, variationId: ${actualVariationId || "null"}, country: ${country}`
            );

            // Find all source warehouses linked to this target warehouse for the targetProductId
            const allSourceMappings = await db
              .selectFrom("sharedProductMapping")
              .innerJoin("warehouseShareLink", "warehouseShareLink.id", "sharedProductMapping.shareLinkId")
              .innerJoin("warehouseShareRecipient", "warehouseShareRecipient.shareLinkId", "warehouseShareLink.id")
              .select(["warehouseShareLink.warehouseId"])
              .where("sharedProductMapping.targetProductId", "=", targetProductId)
              .where("warehouseShareLink.warehouseId", "in", (await db
                .selectFrom("warehouseShareLink")
                .innerJoin("warehouseShareRecipient", "warehouseShareRecipient.shareLinkId", "warehouseShareLink.id")
                .select("warehouseShareLink.warehouseId")
                .where("warehouseShareRecipient.shareLinkId", "in", targetMappings.map(m => m.shareLinkId))
                .execute()).map(w => w.warehouseId))
              .execute();

            const sourceWarehouseIds = allSourceMappings.map(m => m.warehouseId);

            if (sourceWarehouseIds.length === 0) {
              console.log(`[PROPAGATE] No source warehouses linked to target warehouseId: ${targetWarehouse.id} for targetProductId: ${targetProductId}`);
              continue;
            }

            // Fetch stock from all source warehouses
            let sourceStockQuery = db
              .selectFrom("warehouseStock")
              .select(["quantity"])
              .where("productId", "=", productId)
              .where("country", "=", country)
              .where("warehouseId", "in", sourceWarehouseIds);

            if (actualVariationId) {
              sourceStockQuery = sourceStockQuery.where("variationId", "=", actualVariationId);
            } else {
              sourceStockQuery = sourceStockQuery.where("variationId", "is", null);
            }

            const sourceStocks = await sourceStockQuery.execute();

            // Aggregate the stock quantities
            const totalQuantity = sourceStocks.reduce((sum, stock) => sum + stock.quantity, 0);

            console.log(`[PROPAGATE] Aggregated stock for productId: ${productId}, country: ${country}, total quantity: ${totalQuantity}`);

            // Step 8: Map the source variationId to the target variationId (if applicable)
            let targetVariationId: string | null = null;
            if (actualVariationId) {
              const variationMapping = await db
                .selectFrom("sharedVariationMapping")
                .select("targetVariationId")
                .where("shareLinkId", "in", targetMappings.map(m => m.shareLinkId))
                .where("sourceProductId", "=", productId)
                .where("targetProductId", "=", targetProductId)
                .where("sourceVariationId", "=", actualVariationId)
                .executeTakeFirst();

              if (!variationMapping) {
                console.log(`[PROPAGATE] No variation mapping found for sourceVariationId: ${actualVariationId}, skipping`);
                continue;
              }
              targetVariationId = variationMapping.targetVariationId;
              console.log(`[PROPAGATE] Mapped sourceVariationId: ${actualVariationId} to targetVariationId: ${targetVariationId}`);
            }

            // Step 9: Update or insert the aggregated stock in User B's warehouse
            let targetStockQuery = db
              .selectFrom("warehouseStock")
              .select(["id"])
              .where("productId", "=", targetProductId)
              .where("warehouseId", "=", targetWarehouse.id)
              .where("country", "=", country);

            if (targetVariationId) {
              targetStockQuery = targetStockQuery.where("variationId", "=", targetVariationId);
            } else {
              targetStockQuery = targetStockQuery.where("variationId", "is", null);
            }

            const targetStock = await targetStockQuery.executeTakeFirst();

            if (targetStock) {
              console.log(
                `[PROPAGATE] Updating existing stock entry for targetProductId: ${targetProductId}, warehouseId: ${targetWarehouse.id}, country: ${country}, quantity: ${totalQuantity}`
              );
              await db
                .updateTable("warehouseStock")
                .set({
                  quantity: totalQuantity,
                  updatedAt: new Date(),
                })
                .where("id", "=", targetStock.id)
                .execute();
            } else {
              console.log(
                `[PROPAGATE] Inserting new stock entry for targetProductId: ${targetProductId}, warehouseId: ${targetWarehouse.id}, country: ${country}, quantity: ${totalQuantity}`
              );
              await db
                .insertInto("warehouseStock")
                .values({
                  id: generateId("WS"),
                  warehouseId: targetWarehouse.id,
                  productId: targetProductId,
                  variationId: targetVariationId,
                  country,
                  quantity: totalQuantity,
                  organizationId: recipientOrganizationId, // Use User B's organizationId
                  tenantId: targetWarehouse.tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .execute();
            }

            console.log(`[PROPAGATE] Successfully updated stock for targetProductId: ${targetProductId}`);
          }
        }
      }
    }

    return NextResponse.json({ message: "Stock updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/warehouses/[id]/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}