import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const requestSchema = z.object({
  shareLinkId: z.string(),
  warehouseId: z.string(),
});

// Helper to generate string-based IDs
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const { shareLinkId, warehouseId } = parsed.data;

    // Fetch share link and source warehouse details
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select(["warehouseShareLink.id", "warehouseShareLink.warehouseId", "warehouseShareLink.status", "warehouse.countries"])
      .where("warehouseShareLink.id", "=", shareLinkId)
      .where("warehouseShareLink.status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found or inactive" }, { status: 404 });
    }

    // Verify user is a recipient
    const recipient = await db
      .selectFrom("warehouseShareRecipient")
      .select("recipientUserId")
      .where("shareLinkId", "=", shareLinkId)
      .where("recipientUserId", "=", userId)
      .executeTakeFirst();

    if (!recipient) {
      return NextResponse.json({ error: "You are not a recipient of this share link" }, { status: 403 });
    }

    // Validate target warehouse ownership and fetch organizationId
    const targetWarehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries", "organizationId"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();
    if (!targetWarehouse) {
      return NextResponse.json({ error: "Target warehouse not found" }, { status: 404 });
    }

    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", userId)
      .executeTakeFirst();
    if (!tenant || tenant.id !== targetWarehouse.tenantId) {
      return NextResponse.json({ error: "Unauthorized: You do not own this warehouse" }, { status: 403 });
    }

    // Handle organizationId: it could be a string, JSON string, or array
    let warehouseOrganizations: string[] = [];
    if (Array.isArray(targetWarehouse.organizationId)) {
      warehouseOrganizations = targetWarehouse.organizationId;
    } else if (typeof targetWarehouse.organizationId === "string") {
      try {
        const parsed = JSON.parse(targetWarehouse.organizationId);
        warehouseOrganizations = Array.isArray(parsed) ? parsed : [targetWarehouse.organizationId];
      } catch (e) {
        warehouseOrganizations = [targetWarehouse.organizationId];
      }
    }

    if (!warehouseOrganizations || warehouseOrganizations.length === 0) {
      return NextResponse.json({ error: "Target warehouse is not associated with any organization" }, { status: 400 });
    }

    // Determine the organizationId to use for products
    let organizationId: string;
    if (activeOrganizationId && warehouseOrganizations.includes(activeOrganizationId)) {
      organizationId = activeOrganizationId;
    } else {
      organizationId = warehouseOrganizations[0];
    }

    // Verify the organizationId exists
    const organization = await db
      .selectFrom("organization")
      .select("id")
      .where("id", "=", organizationId)
      .executeTakeFirst();
    if (!organization) {
      return NextResponse.json({ error: "Invalid organizationId for warehouse stock" }, { status: 400 });
    }

    // Fetch shared products
    const sharedProducts = await db
      .selectFrom("sharedProduct")
      .select(["productId", "variationId", "cost"])
      .where("shareLinkId", "=", shareLinkId)
      .execute();

    const warehouseCountries = JSON.parse(shareLink.countries) as string[];
    const targetCountries = JSON.parse(targetWarehouse.countries) as string[];

    // Validate countries and costs
    for (const product of sharedProducts) {
      const cost = product.cost as Record<string, number>;
      for (const country of Object.keys(cost)) {
        if (!targetCountries.includes(country)) {
          return NextResponse.json({ error: `Target warehouse does not support country ${country}` }, { status: 400 });
        }
        if (!warehouseCountries.includes(country)) {
          return NextResponse.json({ error: `Country ${country} not supported by shared warehouse` }, { status: 400 });
        }
      }
    }

    // Map old product IDs to new product IDs for User B's tenant
    const productIdMap = new Map<string, string>(); // Maps User A's productId to User B's new productId
    const variationIdMap = new Map<string, string>(); // Maps User A's variationId to User B's new variationId

    // Sync products
    for (const product of sharedProducts) {
      const cost = product.cost as Record<string, number>;
      for (const [country, sharedCost] of Object.entries(cost)) {
        let targetProductId: string;
        if (productIdMap.has(product.productId)) {
          targetProductId = productIdMap.get(product.productId)!;
        } else {
          // Check if this product has already been synced into User B's tenant (across all share links)
          const existingMapping = await db
            .selectFrom("sharedProductMapping")
            .innerJoin("products", "products.id", "sharedProductMapping.targetProductId")
            .select(["sharedProductMapping.targetProductId"])
            .where("sharedProductMapping.sourceProductId", "=", product.productId)
            .where("products.tenantId", "=", targetWarehouse.tenantId)
            .executeTakeFirst();

          if (existingMapping) {
            targetProductId = existingMapping.targetProductId;
            productIdMap.set(product.productId, targetProductId);
            console.log(`[SYNC] Reusing existing product mapping for sourceProductId: ${product.productId} -> targetProductId: ${targetProductId}`);
          } else {
            // Check if the product exists in the target tenant (unlikely since we're generating new IDs, but good to check)
            const existingProduct = await db
              .selectFrom("products")
              .select(["id", "cost"])
              .where("id", "=", product.productId)
              .where("tenantId", "=", targetWarehouse.tenantId)
              .executeTakeFirst();

            if (existingProduct) {
              targetProductId = existingProduct.id;
              productIdMap.set(product.productId, targetProductId);
            } else {
              // Product doesn't exist in the target tenant, so create a new one with a new ID
              targetProductId = generateId("PROD");
              productIdMap.set(product.productId, targetProductId);
              console.log(`[SYNC] Creating new product for sourceProductId: ${product.productId} -> targetProductId: ${targetProductId}`);

              // Fetch the source product to copy required fields
              const sourceProduct = await db
                .selectFrom("products")
                .select([
                  "title",
                  "sku",
                  "status",
                  "productType",
                  "regularPrice",
                  "salePrice",
                  "allowBackorders",
                  "manageStock",
                  "stockStatus",
                  "description",
                  "image",
                ])
                .where("id", "=", product.productId)
                .executeTakeFirst();

              if (!sourceProduct) {
                return NextResponse.json(
                  { error: `Source product with ID ${product.productId} not found` },
                  { status: 404 }
                );
              }

              // Check if the SKU already exists in the products table (globally)
              let finalSku = sourceProduct.sku;
              const existingSku = await db
                .selectFrom("products")
                .select("id")
                .where("sku", "=", finalSku)
                .executeTakeFirst();

              if (existingSku) {
                do {
                  finalSku = `SKU-${Math.random().toString(36).substring(2, 10)}`;
                } while (
                  await db
                    .selectFrom("products")
                    .select("id")
                    .where("sku", "=", finalSku)
                    .executeTakeFirst()
                );
              }

              // Compute stockStatus: For variable products, we'll adjust this after fetching variations
              let stockStatus = sourceProduct.manageStock ? "managed" : "unmanaged";

              // Insert new product with a new ID
              await db
                .insertInto("products")
                .values({
                  id: targetProductId,
                  organizationId,
                  tenantId: targetWarehouse.tenantId,
                  title: sourceProduct.title || "Unknown Product",
                  sku: finalSku,
                  status: sourceProduct.status || "draft",
                  productType: sourceProduct.productType || "simple",
                  regularPrice: sourceProduct.regularPrice || { [country]: sharedCost },
                  salePrice: sourceProduct.salePrice || null,
                  cost: { [country]: sharedCost },
                  allowBackorders: sourceProduct.allowBackorders || false,
                  manageStock: sourceProduct.manageStock || false,
                  stockStatus, // Will be updated later if VARIABLE product
                  description: sourceProduct.description || null,
                  image: sourceProduct.image || null,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .execute();

              // Fetch and copy categories
              const sourceCategories = await db
                .selectFrom("productCategory")
                .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
                .select(["productCategories.id", "productCategories.name", "productCategories.slug"])
                .where("productCategory.productId", "=", product.productId)
                .execute();

              for (const category of sourceCategories) {
                // Check if the category exists in User B's organization
                let targetCategoryId = await db
                  .selectFrom("productCategories")
                  .select("id")
                  .where("organizationId", "=", organizationId)
                  .where("slug", "=", category.slug)
                  .executeTakeFirst();

                if (!targetCategoryId) {
                  // Create the category in User B's organization
                  targetCategoryId = { id: generateId("CAT") };
                  await db
                    .insertInto("productCategories")
                    .values({
                      id: targetCategoryId.id,
                      name: category.name,
                      slug: category.slug,
                      image: null,
                      order: 0,
                      organizationId,
                      parentId: null,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .execute();
                }

                // Link the category to the new product
                await db.insertInto("productCategory").values({
                  productId: targetProductId,
                  categoryId: targetCategoryId.id,
                }).execute();
              }

              // Fetch and copy attributes
              const sourceAttrRows = await db
                .selectFrom("productAttributeValues")
                .innerJoin("productAttributes", "productAttributes.id", "productAttributeValues.attributeId")
                .innerJoin("productAttributeTerms", "productAttributeTerms.id", "productAttributeValues.termId")
                .select([
                  "productAttributeValues.attributeId",
                  "productAttributes.name as attrName",
                  "productAttributes.slug as attrSlug",
                  "productAttributeTerms.id as termId",
                  "productAttributeTerms.name as termName",
                  "productAttributeTerms.slug as termSlug",
                ])
                .where("productAttributeValues.productId", "=", product.productId)
                .execute();

              const attrMap = new Map<string, string>(); // Maps source attributeId to target attributeId
              const termMap = new Map<string, string>(); // Maps source termId to target termId

              // Group attributes by attributeId to handle terms
              const attrGroups = sourceAttrRows.reduce(
                (acc, row) => {
                  if (!acc[row.attributeId]) {
                    acc[row.attributeId] = {
                      name: row.attrName,
                      slug: row.attrSlug,
                      terms: [],
                    };
                  }
                  acc[row.attributeId].terms.push({
                    termId: row.termId,
                    termName: row.termName,
                    termSlug: row.termSlug,
                  });
                  return acc;
                },
                {} as Record<string, { name: string; slug: string; terms: { termId: string; termName: string; termSlug: string }[] }>
              );

              for (const [sourceAttrId, attr] of Object.entries(attrGroups)) {
                // Check if the attribute exists in User B's organization
                let targetAttrId = await db
                  .selectFrom("productAttributes")
                  .select("id")
                  .where("organizationId", "=", organizationId)
                  .where("slug", "=", attr.slug)
                  .executeTakeFirst();

                if (!targetAttrId) {
                  // Create the attribute in User B's organization
                  targetAttrId = { id: generateId("ATTR") };
                  await db
                    .insertInto("productAttributes")
                    .values({
                      id: targetAttrId.id,
                      name: attr.name,
                      slug: attr.slug,
                      organizationId,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .execute();
                }

                attrMap.set(sourceAttrId, targetAttrId.id);

                // Copy terms
                for (const term of attr.terms) {
                  let targetTermId = await db
                    .selectFrom("productAttributeTerms")
                    .select("id")
                    .where("attributeId", "=", targetAttrId.id)
                    .where("organizationId", "=", organizationId)
                    .where("slug", "=", term.termSlug)
                    .executeTakeFirst();

                  if (!targetTermId) {
                    targetTermId = { id: generateId("TERM") };
                    await db
                      .insertInto("productAttributeTerms")
                      .values({
                        id: targetTermId.id,
                        attributeId: targetAttrId.id,
                        name: term.termName,
                        slug: term.termSlug,
                        organizationId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      })
                      .execute();
                  }

                  termMap.set(term.termId, targetTermId.id);

                  // Link the term to the new product
                  await db
                    .insertInto("productAttributeValues")
                    .values({
                      productId: targetProductId,
                      attributeId: targetAttrId.id,
                      termId: targetTermId.id,
                    })
                    .execute();
                }
              }

              // Fetch and copy variations (if any)
              if (sourceProduct.productType === "variable") {
                const sourceVariations = await db
                  .selectFrom("productVariations")
                  .selectAll()
                  .where("productId", "=", product.productId)
                  .execute();

                for (const variation of sourceVariations) {
                  const targetVariationId = generateId("VAR");
                  variationIdMap.set(variation.id, targetVariationId);

                  // Map variation attributes (if they reference attribute terms)
                  const sourceAttributes = typeof variation.attributes === "string"
                    ? JSON.parse(variation.attributes)
                    : variation.attributes;
                  const targetAttributes: Record<string, string> = {};
                  for (const [attrId, termId] of Object.entries(sourceAttributes)) {
                    const targetAttrId = attrMap.get(attrId);
                    const targetTermId = termMap.get(termId as string);
                    if (targetAttrId && targetTermId) {
                      targetAttributes[targetAttrId] = targetTermId;
                    }
                  }

                  // Generate a unique SKU for the variation
                  let variationSku = variation.sku;
                  const existingVariationSku = await db
                    .selectFrom("productVariations")
                    .select("id")
                    .where("sku", "=", variationSku)
                    .executeTakeFirst();

                  if (existingVariationSku) {
                    do {
                      variationSku = `VAR-${Math.random().toString(36).substring(2, 10)}`;
                    } while (
                      await db
                        .selectFrom("productVariations")
                        .select("id")
                        .where("sku", "=", variationSku)
                        .executeTakeFirst()
                    );
                  }

                  await db
                    .insertInto("productVariations")
                    .values({
                      id: targetVariationId,
                      productId: targetProductId,
                      attributes: JSON.stringify(targetAttributes),
                      sku: variationSku,
                      image: variation.image ?? null,
                      regularPrice: variation.regularPrice,
                      salePrice: variation.salePrice,
                      cost: variation.cost ?? {},
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .execute();

                  // Store the variation mapping in sharedVariationMapping
                  await db
                    .insertInto("sharedVariationMapping")
                    .values({
                      id: generateId("SVM"),
                      shareLinkId,
                      sourceProductId: product.productId,
                      targetProductId,
                      sourceVariationId: variation.id,
                      targetVariationId,
                      createdAt: new Date(),
                      updatedAt: new Date(),
                    })
                    .execute();

                  // Update stockStatus for variable products
                  if (variation.stock && Object.keys(variation.stock).length > 0) {
                    stockStatus = "managed";
                  }
                }

                // Update stockStatus in the products table if necessary
                if (stockStatus !== sourceProduct.stockStatus) {
                  await db
                    .updateTable("products")
                    .set({ stockStatus })
                    .where("id", "=", targetProductId)
                    .execute();
                }
              }
            }
          }
        }

        // Insert the mapping into sharedProductMapping (even if the product was reused)
        const existingMappingForShareLink = await db
          .selectFrom("sharedProductMapping")
          .select("id")
          .where("shareLinkId", "=", shareLinkId)
          .where("sourceProductId", "=", product.productId)
          .where("targetProductId", "=", targetProductId)
          .executeTakeFirst();

        if (!existingMappingForShareLink) {
          await db
            .insertInto("sharedProductMapping")
            .values({
              id: generateId("SPM"),
              shareLinkId,
              sourceProductId: product.productId,
              targetProductId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .execute();
          console.log(`[SYNC] Created sharedProductMapping for shareLinkId: ${shareLinkId}, sourceProductId: ${product.productId} -> targetProductId: ${targetProductId}`);
        }

        // Fetch and copy warehouseStock entries for the source product
        const sourceStock = await db
          .selectFrom("warehouseStock")
          .select(["warehouseId", "country", "quantity", "variationId"])
          .where("productId", "=", product.productId)
          .where("warehouseId", "=", shareLink.warehouseId)
          .execute();

        for (const stockEntry of sourceStock) {
          const targetVariationId = stockEntry.variationId ? variationIdMap.get(stockEntry.variationId) : null;

          // Only copy stock entries if variationId is null (simple product) or if we have a mapped variationId
          if (stockEntry.variationId && !targetVariationId) continue;

          // Fetch all share links that the recipient user is part of and that map to this target product
          const recipientShareLinks = await db
            .selectFrom("warehouseShareRecipient")
            .innerJoin("sharedProductMapping", "sharedProductMapping.shareLinkId", "warehouseShareRecipient.shareLinkId")
            .innerJoin("warehouseShareLink", "warehouseShareLink.id", "warehouseShareRecipient.shareLinkId")
            .select(["warehouseShareLink.warehouseId"])
            .where("warehouseShareRecipient.recipientUserId", "=", userId)
            .where("sharedProductMapping.targetProductId", "=", targetProductId)
            .execute();

          const sourceWarehouseIds = recipientShareLinks.map(link => link.warehouseId);

          if (sourceWarehouseIds.length === 0) {
            console.log(`[SYNC] No source warehouses found for targetProductId: ${targetProductId}`);
            continue;
          }

          // Fetch stock from all source warehouses
          let stockQuery = db
            .selectFrom("warehouseStock")
            .select(["quantity"])
            .where("productId", "=", product.productId)
            .where("country", "=", stockEntry.country)
            .where("warehouseId", "in", sourceWarehouseIds);
          if (stockEntry.variationId) {
            stockQuery = stockQuery.where("variationId", "=", stockEntry.variationId);
          } else {
            stockQuery = stockQuery.where("variationId", "is", null);
          }

          const sourceStocks = await stockQuery.execute();

          // Aggregate the stock quantities
          const totalQuantity = sourceStocks.reduce((sum, stock) => sum + stock.quantity, 0);

          // Update or insert the aggregated stock in the target warehouse
          let targetStockQuery = db
            .selectFrom("warehouseStock")
            .select(["id", "quantity"])
            .where("warehouseId", "=", targetWarehouse.id)
            .where("productId", "=", targetProductId)
            .where("country", "=", stockEntry.country);
          if (stockEntry.variationId) {
            targetStockQuery = targetStockQuery.where("variationId", "=", targetVariationId!);
          } else {
            targetStockQuery = targetStockQuery.where("variationId", "is", null);
          }

          const existingStock = await targetStockQuery.executeTakeFirst();

          if (existingStock) {
            await db
              .updateTable("warehouseStock")
              .set({
                quantity: totalQuantity,
                updatedAt: new Date(),
              })
              .where("id", "=", existingStock.id)
              .execute();
            console.log(`[SYNC] Updated stock for targetProductId: ${targetProductId}, country: ${stockEntry.country}, new quantity: ${totalQuantity}`);
          } else {
            await db
              .insertInto("warehouseStock")
              .values({
                id: generateId("WS"),
                warehouseId: targetWarehouse.id,
                productId: targetProductId,
                variationId: targetVariationId,
                country: stockEntry.country,
                quantity: totalQuantity,
                organizationId,
                tenantId: targetWarehouse.tenantId,
                createdAt: new Date(),
                updatedAt: new Date(),
              })
              .execute();
            console.log(`[SYNC] Inserted stock for targetProductId: ${targetProductId}, country: ${stockEntry.country}, quantity: ${totalQuantity}`);
          }
        }

        // Update product cost in the target tenant's product catalog
        const existingProduct = await db
          .selectFrom("products")
          .select(["id", "cost"])
          .where("id", "=", targetProductId)
          .where("tenantId", "=", targetWarehouse.tenantId)
          .executeTakeFirst();

        if (existingProduct) {
          const currentCost = typeof existingProduct.cost === "string" ? JSON.parse(existingProduct.cost) : existingProduct.cost;
          const updatedCost = { ...currentCost, [country]: sharedCost };
          await db
            .updateTable("products")
            .set({
              cost: updatedCost,
              updatedAt: new Date(),
            })
            .where("id", "=", targetProductId)
            .where("tenantId", "=", targetWarehouse.tenantId)
            .execute();
        }
      }
    }

    // Return the targetProductIds in the response
    const syncedProducts = Array.from(productIdMap.entries()).map(([sourceProductId, targetProductId]) => ({
      sourceProductId,
      targetProductId,
    }));

    return NextResponse.json(
      { 
        message: "Warehouse synced successfully",
        syncedProducts, // Include the mapping so the frontend knows the new product IDs
      }, 
      { status: 200 }
    );
  } catch (error) {
    console.error("[POST /api/warehouses/sync] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}