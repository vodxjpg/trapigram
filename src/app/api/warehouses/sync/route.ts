import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const requestSchema = z.object({
  shareLinkId: z.string(),
  warehouseId: z.string(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;

    const body = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    }
    const { shareLinkId, warehouseId } = parsed.data;

    // Fetch share link
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select([
        "warehouseShareLink.id",
        "warehouseShareLink.warehouseId",
        "warehouseShareLink.status",
        "warehouse.countries",
      ])
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

    // Validate target warehouse ownership
    const targetWarehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries"])
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
          return NextResponse.json(
            { error: `Target warehouse does not support country ${country}` },
            { status: 400 }
          );
        }
        if (!warehouseCountries.includes(country)) {
          return NextResponse.json(
            { error: `Country ${country} not supported by shared warehouse` },
            { status: 400 }
          );
        }
      }
    }

    // Sync products: For simplicity, we'll overwrite existing stock entries for these products
    for (const product of sharedProducts) {
      const cost = product.cost as Record<string, number>;
      for (const [country, sharedCost] of Object.entries(cost)) {
        // Check if the product exists in the target warehouse stock
        const existingStock = await db
          .selectFrom("warehouseStock")
          .select("id")
          .where("warehouseId", "=", warehouseId)
          .where("productId", "=", product.productId)
          .where("variationId", "=", product.variationId)
          .where("country", "=", country)
          .executeTakeFirst();

        if (existingStock) {
          // Update existing stock entry
          await db
            .updateTable("warehouseStock")
            .set({
              quantity: 0, // For simplicity, set quantity to 0; adjust based on business logic
              updatedAt: new Date(),
            })
            .where("id", "=", existingStock.id)
            .execute();
        } else {
          // Insert new stock entry
          await db
            .insertInto("warehouseStock")
            .values({
              id: uuidv4(),
              warehouseId,
              productId: product.productId,
              variationId: product.variationId,
              country,
              quantity: 0, // For simplicity; adjust as needed
              organizationId: targetWarehouse.tenantId, // Simplified; adjust based on your schema
              tenantId: targetWarehouse.tenantId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .execute();
        }

        // Optionally, update product cost in the target tenant's product catalog
        const existingProduct = await db
          .selectFrom("products")
          .select(["id", "cost"])
          .where("id", "=", product.productId)
          .where("tenantId", "=", targetWarehouse.tenantId)
          .executeTakeFirst();

        if (existingProduct) {
          const currentCost = typeof existingProduct.cost === "string"
            ? JSON.parse(existingProduct.cost)
            : existingProduct.cost;
          const updatedCost = { ...currentCost, [country]: sharedCost };
          await db
            .updateTable("products")
            .set({
              cost: updatedCost,
              updatedAt: new Date(),
            })
            .where("id", "=", product.productId)
            .where("tenantId", "=", targetWarehouse.tenantId)
            .execute();
        } else {
          // If product doesn't exist, insert it (simplified; you may need to copy more fields)
          await db
            .insertInto("products")
            .values({
              id: product.productId,
              tenantId: targetWarehouse.tenantId,
              title: (await db.selectFrom("products").select("title").where("id", "=", product.productId).executeTakeFirst())?.title || "Unknown Product",
              cost: { [country]: sharedCost },
              productType: "simple", // Adjust based on actual type
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .execute();
        }
      }
    }

    return NextResponse.json({ message: "Warehouse synced successfully" }, { status: 200 });
  } catch (error) {
    console.error("[POST /api/warehouses/sync] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}