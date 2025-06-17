import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import crypto from "crypto";

const costSchema = z.record(z.string(), z.number().positive("Cost must be a positive number")).optional();

const productSchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable(),
  cost: costSchema,
});

const requestSchema = z.object({
  recipientUserIds: z.array(z.string()).min(1, "At least one recipient is required"),
  products: z.array(productSchema).min(1, "At least one product is required"),
});

// Helper to generate string-based IDs
function generateId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

// Helper to generate a secure random token
function generateSecureToken(): string {
  return crypto.randomBytes(16).toString("hex"); // Generates a 32-character hexadecimal string
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;
    const params = await context.params;
    const warehouseId = params.id;

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const { recipientUserIds, products } = parsed.data;

    // Validate warehouse ownership
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();
    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", userId)
      .executeTakeFirst();
    if (!tenant || tenant.id !== warehouse.tenantId) {
      return NextResponse.json({ error: "Unauthorized: You do not own this warehouse" }, { status: 403 });
    }

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
    const warehouseCountries = JSON.parse(warehouse.countries) as string[];
    for (const { productId, variationId, cost } of products) {
      // Validate product exists
      const product = await db
        .selectFrom("products")
        .select(["id", "cost", "productType"])
        .where("id", "=", productId)
        .executeTakeFirst();
      if (!product) {
        return NextResponse.json({ error: `Product ${productId} not found` }, { status: 400 });
      }

      // Parse product cost
      const productCost = typeof product.cost === "string" ? JSON.parse(product.cost) : product.cost;

      // Validate variation if provided
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

      // Validate stock
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

      // Validate cost (only for provided countries)
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
      } else {
        // Ensure at least one country with stock is available
        if (!stock.some((s) => s.quantity > 0)) {
          return NextResponse.json(
            { error: `No stock available for product ${productId}${variationId ? ` variation ${variationId}` : ""}` },
            { status: 400 }
          );
        }
      }
    }

    // Create share link
    const shareLinkId = generateId("SL");
    const token = generateSecureToken(); // Use the new secure token generator
    await db
      .insertInto("warehouseShareLink")
      .values({
        id: shareLinkId,
        warehouseId,
        creatorUserId: userId,
        token,
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    // Create recipients
    const recipientInserts = recipientUserIds.map((recipientUserId) => ({
      id: generateId("WSR"),
      shareLinkId,
      recipientUserId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("warehouseShareRecipient").values(recipientInserts).execute();

    // Create shared products
    const productInserts = products.map(({ productId, variationId, cost }) => ({
      id: generateId("SP"),
      shareLinkId,
      productId,
      variationId,
      cost: cost || {}, // Store empty object if no countries selected
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("sharedProduct").values(productInserts).execute();

    return NextResponse.json(
      {
        shareLinkId,
        token,
        url: `https://trapyfy.com/share/${token}`,
        products,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[POST /api/warehouses/[id]/share-links] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}