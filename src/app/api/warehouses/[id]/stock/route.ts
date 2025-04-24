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
  })
);

// Helper to generate string-based IDs
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
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
        return NextResponse.json({ error: "Unauthorized: You do not own this warehouse" }, { status: 403 });
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
        "productVariations.cost as variationCost",
        "productVariations.sku as variationSku",
      ])
      .where("warehouseStock.warehouseId", "=", warehouseId)
      .where("warehouseStock.quantity", ">", 0)
      .execute();

    const warehouseCountries = JSON.parse(warehouse.countries) as string[];

    // Transform stock data
    const stockItems = stock.map((item) => ({
      productId: item.productId,
      variationId: item.variationId,
      title: item.variationId ? `${item.title} - ${item.variationSku}` : item.title,
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
    }));

    return NextResponse.json({ stock: stockItems, countries: warehouseCountries }, { status: 200 });
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
      const stockQuery = db
        .selectFrom("warehouseStock")
        .select("id")
        .where("warehouseId", "=", warehouseId)
        .where("productId", "=", productId)
        .where("country", "=", country);

      if (variationId) {
        stockQuery.where("variationId", "=", variationId);
      } else {
        stockQuery.where("variationId", "is", null);
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

    // Propagate stock updates to synced products (User B)
    for (const update of stockUpdates) {
      const { productId, variationId, country, quantity } = update;

      console.log(
        `[PROPAGATE] Processing stock update for productId: ${productId}, variationId: ${variationId || "null"}, country: ${country}, quantity: ${quantity}`
      );

      // Step 1: Find all share links that include this product
      const sharedProductQuery = db
        .selectFrom("sharedProduct")
        .select(["id", "shareLinkId"])
        .where("productId", "=", productId);

      if (variationId) {
        sharedProductQuery.where("variationId", "=", variationId);
      } else {
        sharedProductQuery.where("variationId", "is", null);
      }

      const sharedProducts = await sharedProductQuery.execute();

      if (sharedProducts.length === 0) {
        console.log(`[PROPAGATE] No sharedProduct entries found for productId: ${productId}, variationId: ${variationId || "null"}`);
        continue;
      }

      console.log(`[PROPAGATE] Found ${sharedProducts.length} sharedProduct entries for productId: ${productId}`);

      for (const sharedProduct of sharedProducts) {
        console.log(`[PROPAGATE] Processing shareLinkId: ${sharedProduct.shareLinkId}`);

        // Step 2: Find all mappings for this share link
        const mappings = await db
          .selectFrom("sharedProductMapping")
          .select(["id", "sourceProductId", "targetProductId"])
          .where("shareLinkId", "=", sharedProduct.shareLinkId)
          .where("sourceProductId", "=", productId)
          .execute();

        if (mappings.length === 0) {
          console.log(`[PROPAGATE] No mappings found for shareLinkId: ${sharedProduct.shareLinkId}, sourceProductId: ${productId}`);
          continue;
        }

        console.log(`[PROPAGATE] Found ${mappings.length} mappings for shareLinkId: ${sharedProduct.shareLinkId}`);

        for (const mapping of mappings) {
          console.log(`[PROPAGATE] Mapping - sourceProductId: ${mapping.sourceProductId}, targetProductId: ${mapping.targetProductId}`);

          // Step 3: Find the target warehouse for User B
          let targetWarehouse = await db
            .selectFrom("warehouseStock")
            .select(["warehouseId", "tenantId", "organizationId"])
            .where("productId", "=", mapping.targetProductId)
            .distinct()
            .executeTakeFirst();

          if (!targetWarehouse) {
            console.log(
              `[PROPAGATE] No warehouseStock found for targetProductId: ${mapping.targetProductId}, falling back to share link data`
            );

            // Fallback: Find the warehouse used during sync
            const shareLink = await db
              .selectFrom("warehouseShareLink")
              .select(["id", "warehouseId"])
              .where("id", "=", sharedProduct.shareLinkId)
              .executeTakeFirst();

            if (!shareLink) {
              console.log(`[PROPAGATE] Share link ${sharedProduct.shareLinkId} not found`);
              continue;
            }

            const recipient = await db
              .selectFrom("warehouseShareRecipient")
              .select("recipientUserId")
              .where("shareLinkId", "=", sharedProduct.shareLinkId)
              .executeTakeFirst();

            if (!recipient) {
              console.log(`[PROPAGATE] No recipient found for shareLinkId: ${sharedProduct.shareLinkId}`);
              continue;
            }

            const targetTenant = await db
              .selectFrom("tenant")
              .select("id")
              .where("ownerUserId", "=", recipient.recipientUserId)
              .executeTakeFirst();

            if (!targetTenant) {
              console.log(`[PROPAGATE] No tenant found for recipientUserId: ${recipient.recipientUserId}`);
              continue;
            }

            // Find a warehouse associated with the target tenant
            targetWarehouse = await db
              .selectFrom("warehouse")
              .select(["id as warehouseId", "tenantId", "organizationId"])
              .where("tenantId", "=", targetTenant.id)
              .executeTakeFirst();

            if (!targetWarehouse) {
              console.log(`[PROPAGATE] No warehouse found for tenantId: ${targetTenant.id}, skipping`);
              continue;
            }
          }

          console.log(`[PROPAGATE] Target warehouse found - warehouseId: ${targetWarehouse.warehouseId}, tenantId: ${targetWarehouse.tenantId}`);

          // Step 4: Map the source variationId to the target variationId (if applicable)
          let targetVariationId: string | null = null;
          if (variationId) {
            const variationMapping = await db
              .selectFrom("sharedVariationMapping")
              .select("targetVariationId")
              .where("shareLinkId", "=", sharedProduct.shareLinkId)
              .where("sourceProductId", "=", productId)
              .where("targetProductId", "=", mapping.targetProductId)
              .where("sourceVariationId", "=", variationId)
              .executeTakeFirst();

            if (!variationMapping) {
              console.log(`[PROPAGATE] No variation mapping found for sourceVariationId: ${variationId}, skipping`);
              continue;
            }
            targetVariationId = variationMapping.targetVariationId;
            console.log(`[PROPAGATE] Mapped sourceVariationId: ${variationId} to targetVariationId: ${targetVariationId}`);
          }

          // Step 5: Update or insert stock for User B
          const targetStockQuery = db
            .selectFrom("warehouseStock")
            .select(["id"])
            .where("productId", "=", mapping.targetProductId)
            .where("warehouseId", "=", targetWarehouse.warehouseId)
            .where("country", "=", country);

          if (targetVariationId) {
            targetStockQuery.where("variationId", "=", targetVariationId);
          } else {
            targetStockQuery.where("variationId", "is", null);
          }

          const targetStock = await targetStockQuery.executeTakeFirst();

          if (targetStock) {
            console.log(
              `[PROPAGATE] Updating existing stock entry for targetProductId: ${mapping.targetProductId}, warehouseId: ${targetWarehouse.warehouseId}, country: ${country}, quantity: ${quantity}`
            );
            await db
              .updateTable("warehouseStock")
              .set({
                quantity,
                updatedAt: new Date(),
              })
              .where("id", "=", targetStock.id)
              .execute();
          } else {
            console.log(
              `[PROPAGATE] Inserting new stock entry for targetProductId: ${mapping.targetProductId}, warehouseId: ${targetWarehouse.warehouseId}, country: ${country}, quantity: ${quantity}`
            );
            await db
              .insertInto("warehouseStock")
              .values({
                id: generateId("WS"),
                warehouseId: targetWarehouse.warehouseId,
                productId: mapping.targetProductId,
                variationId: targetVariationId,
                country,
                quantity,
                organizationId: targetWarehouse.organizationId,
                tenantId: targetWarehouse.tenantId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .execute();
          }

          console.log(`[PROPAGATE] Successfully updated stock for targetProductId: ${mapping.targetProductId}`);
        }
      }
    }

    return NextResponse.json({ message: "Stock updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[PATCH /api/warehouses/[id]/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}