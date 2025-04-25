import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const costSchema = z.record(z.string(), z.number().positive("Cost must be a positive number")).optional();

const productSchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable(),
  cost: costSchema,
});

const updateSchema = z.object({
  recipientUserIds: z.array(z.string()).min(1, "At least one recipient is required"),
  products: z.array(productSchema).min(1, "At least one product is required"),
});

// Helper to generate string-based IDs
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

export async function GET(req: NextRequest, context: { params: Promise<{ shareLinkId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;
    const params = await context.params;
    const shareLinkId = params.shareLinkId;

    // Fetch share link
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select([
        "warehouseShareLink.id as shareLinkId",
        "warehouseShareLink.warehouseId",
        "warehouseShareLink.token",
        "warehouseShareLink.status",
        "warehouseShareLink.createdAt",
        "warehouse.name as warehouseName",
        "warehouse.countries",
      ])
      .where("warehouseShareLink.id", "=", shareLinkId)
      .where("warehouseShareLink.creatorUserId", "=", userId)
      .where("warehouseShareLink.status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found, inactive, or you are not the creator" }, { status: 404 });
    }

    // Fetch recipients
    const recipients = await db
      .selectFrom("warehouseShareRecipient")
      .innerJoin("user", "user.id", "warehouseShareRecipient.recipientUserId")
      .select(["warehouseShareRecipient.recipientUserId", "user.email", "user.name"])
      .where("warehouseShareRecipient.shareLinkId", "=", shareLinkId)
      .execute();

    // Fetch products
    const products = await db
      .selectFrom("sharedProduct")
      .innerJoin("products", "products.id", "sharedProduct.productId")
      .leftJoin("productVariations", "productVariations.id", "sharedProduct.variationId")
      .select([
        "sharedProduct.id",
        "sharedProduct.productId",
        "sharedProduct.variationId",
        "sharedProduct.cost",
        "products.title as productTitle",
        "products.productType",
        "productVariations.sku as variationSku",
      ])
      .where("sharedProduct.shareLinkId", "=", shareLinkId)
      .execute();

    const formattedProducts = products.map((p) => ({
      id: p.id,
      productId: p.productId,
      variationId: p.variationId,
      title: p.variationId ? `${p.productTitle} - ${p.variationSku}` : p.productTitle,
      cost: p.cost,
      productType: p.productType,
    }));

    return NextResponse.json({
      shareLinkId: shareLink.shareLinkId,
      warehouseId: shareLink.warehouseId,
      warehouseName: shareLink.warehouseName,
      token: shareLink.token,
      status: shareLink.status,
      recipients: recipients.map((r) => ({
        userId: r.recipientUserId,
        email: r.email,
        name: r.name,
      })),
      products: formattedProducts,
      countries: JSON.parse(shareLink.countries),
      createdAt: shareLink.createdAt,
    });
  } catch (error) {
    console.error("[GET /api/warehouses/share-links/[shareLinkId]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: { params: Promise<{ shareLinkId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;
    const params = await context.params;
    const shareLinkId = params.shareLinkId;

    const body = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const { recipientUserIds, products } = parsed.data;

    // Verify share link exists and belongs to user
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select(["warehouseShareLink.id", "warehouseShareLink.warehouseId", "warehouse.countries"])
      .where("warehouseShareLink.id", "=", shareLinkId)
      .where("warehouseShareLink.creatorUserId", "=", userId)
      .where("warehouseShareLink.status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found, inactive, or you are not the creator" }, { status: 404 });
    }

    const warehouseId = shareLink.warehouseId;
    const warehouseCountries = JSON.parse(shareLink.countries) as string[];

    // Validate recipient users
    const validUsers = await db
      .selectFrom("user")
      .select("id")
      .where("id", "in", recipientUserIds)
      .execute();
    if (validUsers.length !== recipientUserIds.length) {
      return NextResponse.json({ error: "One or more recipient user IDs are invalid" }, { status: 400 });
    }

    // Validate products, variations, stock, and costs
    for (const { productId, variationId, cost } of products) {
      const product = await db
        .selectFrom("products")
        .select(["id", "cost", "productType"])
        .where("id", "=", productId)
        .executeTakeFirst();
      if (!product) {
        return NextResponse.json({ error: `Product ${productId} not found` }, { status: 400 });
      }

      const productCost = typeof product.cost === "string" ? JSON.parse(product.cost) : product.cost;

      let baseCost: Record<string, number> = productCost;
      if (variationId) {
        if (product.productType !== "variable") {
          return NextResponse.json({ error: `Product ${productId} is not variable` }, { status: 400 });
        }
        const variation = await db
          .selectFrom("productVariations")
          .select(["id", "cost"])
          .where("id", "=", variationId)
          .where("productId", "=", productId)
          .executeTakeFirst();
        if (!variation) {
          return NextResponse.json({ error: `Variation ${variationId} not found` }, { status: 400 });
        }
        baseCost = typeof variation.cost === "string" ? JSON.parse(variation.cost) : variation.cost;
      }

      const stockQuery = db
        .selectFrom("warehouseStock")
        .select(["country", "quantity"])
        .where("warehouseId", "=", warehouseId)
        .where("productId", "=", productId);
      if (variationId) {
        stockQuery.where("variationId", "=", variationId);
      } else {
        stockQuery.where("variationId", "is", null);
      }
      const stock = await stockQuery.execute();
      if (!stock.some((s) => s.quantity > 0)) {
        return NextResponse.json(
          { error: `No stock available for product ${productId}${variationId ? ` variation ${variationId}` : ""}` },
          { status: 400 }
        );
      }

      if (cost) {
        for (const [country, sharedCost] of Object.entries(cost)) {
          if (!warehouseCountries.includes(country)) {
            return NextResponse.json({ error: `Country ${country} not supported by warehouse` }, { status: 400 });
          }
          if (!(country in baseCost)) {
            return NextResponse.json({ error: `Base cost not defined for country ${country}` }, { status: 400 });
          }
          if (sharedCost <= baseCost[country]) {
            return NextResponse.json(
              { error: `Shared cost for ${country} must be higher than base cost (${baseCost[country]})` },
              { status: 400 }
            );
          }
          if (!stock.some((s) => s.country === country && s.quantity > 0)) {
            return NextResponse.json(
              { error: `No stock available for ${country} for product ${productId}${variationId ? ` variation ${variationId}` : ""}` },
              { status: 400 }
            );
          }
        }
      }
    }

    // Fetch current recipients before updating
    const currentRecipients = await db
      .selectFrom("warehouseShareRecipient")
      .select("recipientUserId")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    const currentRecipientUserIds = currentRecipients.map((r) => r.recipientUserId);

    // Identify removed recipients
    const removedRecipientUserIds = currentRecipientUserIds.filter(
      (id) => !recipientUserIds.includes(id)
    );

    // Clean up products and stock for removed recipients
    if (removedRecipientUserIds.length > 0) {
      console.log(
        `[CLEANUP] Identified ${removedRecipientUserIds.length} removed recipients: ${removedRecipientUserIds.join(", ")}`
      );

      for (const removedUserId of removedRecipientUserIds) {
        console.log(`[CLEANUP] Processing removed recipient: ${removedUserId}`);

        // Find the tenant of the removed recipient
        const removedTenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", removedUserId)
          .executeTakeFirst();

        if (!removedTenant) {
          console.log(`[CLEANUP] No tenant found for removed recipientUserId: ${removedUserId}, skipping`);
          continue;
        }

        // Find all target products synced to this recipient via the share link
        const mappings = await db
          .selectFrom("sharedProductMapping")
          .select(["sourceProductId", "targetProductId"])
          .where("shareLinkId", "=", shareLinkId)
          .execute();

        const targetProductIds = mappings.map((m) => m.targetProductId);

        if (targetProductIds.length === 0) {
          console.log(`[CLEANUP] No synced products found for shareLinkId: ${shareLinkId} for recipient: ${removedUserId}`);
          continue;
        }

        console.log(
          `[CLEANUP] Found ${targetProductIds.length} synced products for recipient: ${removedUserId}: ${targetProductIds.join(", ")}`
        );

        // Delete sharedProductMapping entries first to avoid foreign key constraints
        await db
          .deleteFrom("sharedProductMapping")
          .where("shareLinkId", "=", shareLinkId)
          .where("targetProductId", "in", targetProductIds)
          .execute();
        console.log(`[CLEANUP] Deleted sharedProductMapping entries for shareLinkId: ${shareLinkId}`);

        // Delete sharedVariationMapping entries
        await db
          .deleteFrom("sharedVariationMapping")
          .where("shareLinkId", "=", shareLinkId)
          .where("targetProductId", "in", targetProductIds)
          .execute();
        console.log(`[CLEANUP] Deleted sharedVariationMapping entries for shareLinkId: ${shareLinkId}`);

        // Delete associated warehouseStock entries for these products
        await db
          .deleteFrom("warehouseStock")
          .where("productId", "in", targetProductIds)
          .where("tenantId", "=", removedTenant.id)
          .execute();
        console.log(`[CLEANUP] Deleted warehouseStock entries for products: ${targetProductIds.join(", ")}`);

        // Delete associated variations (if any)
        await db
          .deleteFrom("productVariations")
          .where("productId", "in", targetProductIds)
          .execute();
        console.log(`[CLEANUP] Deleted productVariations for products: ${targetProductIds.join(", ")}`);

        // Delete the products themselves
        await db
          .deleteFrom("products")
          .where("id", "in", targetProductIds)
          .where("tenantId", "=", removedTenant.id)
          .execute();
        console.log(`[CLEANUP] Deleted products: ${targetProductIds.join(", ")}`);
      }
    }

    // Update share link (recipients and products)
    await db.deleteFrom("warehouseShareRecipient").where("shareLinkId", "=", shareLinkId).execute();
    const recipientInserts = recipientUserIds.map((recipientUserId) => ({
      id: generateId("WSR"),
      shareLinkId,
      recipientUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("warehouseShareRecipient").values(recipientInserts).execute();

    await db.deleteFrom("sharedProduct").where("shareLinkId", "=", shareLinkId).execute();
    const productInserts = products.map(({ productId, variationId, cost }) => ({
      id: generateId("SP"),
      shareLinkId,
      productId,
      variationId,
      cost: cost || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("sharedProduct").values(productInserts).execute();

    await db
      .updateTable("warehouseShareLink")
      .set({ updatedAt: new Date() })
      .where("id", "=", shareLinkId)
      .execute();

    // Update costs for all synced products in recipients' catalogs
    const mappings = await db
      .selectFrom("sharedProductMapping")
      .select(["sourceProductId", "targetProductId"])
      .where("shareLinkId", "=", shareLinkId)
      .execute();

    for (const mapping of mappings) {
      const sourceProduct = products.find((p) => p.productId === mapping.sourceProductId);
      if (!sourceProduct || !sourceProduct.cost) continue;

      const targetProduct = await db
        .selectFrom("products")
        .select(["id", "cost"])
        .where("id", "=", mapping.targetProductId)
        .executeTakeFirst();

      if (targetProduct) {
        const currentCost = typeof targetProduct.cost === "string" ? JSON.parse(targetProduct.cost) : targetProduct.cost;
        const updatedCost = { ...currentCost, ...sourceProduct.cost };

        await db
          .updateTable("products")
          .set({
            cost: updatedCost,
            updatedAt: new Date(),
          })
          .where("id", "=", mapping.targetProductId)
          .execute();
      }
    }

    return NextResponse.json({ message: "Share link updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/warehouses/share-links/[shareLinkId]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ shareLinkId: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;
    const params = await context.params;
    const shareLinkId = params.shareLinkId;

    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .select("id")
      .where("id", "=", shareLinkId)
      .where("creatorUserId", "=", userId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found, inactive, or you are not the creator" }, { status: 404 });
    }

    await db.deleteFrom("warehouseShareRecipient").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("sharedProduct").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("warehouseShareLink").where("id", "=", shareLinkId).execute();

    return NextResponse.json({ message: "Share link deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/warehouses/share-links/[shareLinkId]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}