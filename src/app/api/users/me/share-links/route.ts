import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { propagateDeleteDeep } from "@/lib/propagate-delete"; 
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
    // Fetch share links
    const shareLinks = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select([
        "warehouseShareLink.id as shareLinkId",
        "warehouseShareLink.warehouseId",
        "warehouseShareLink.token",
        "warehouseShareLink.status",
        "warehouseShareLink.createdAt",
        "warehouse.name as warehouseName",
      ])
      .where("warehouseShareLink.creatorUserId", "=", userId)
      .execute();

    // Fetch recipients and products for each link
    const result = await Promise.all(
      shareLinks.map(async (link) => {
        const recipients = await db
          .selectFrom("warehouseShareRecipient")
          .innerJoin("user", "user.id", "warehouseShareRecipient.recipientUserId")
          .select([
            "warehouseShareRecipient.recipientUserId",
            "user.email",
            "user.name",
          ])
          .where("warehouseShareRecipient.shareLinkId", "=", link.shareLinkId)
          .execute();

        const products = await db
          .selectFrom("sharedProduct")
          .innerJoin("products", "products.id", "sharedProduct.productId")
          .leftJoin("productVariations", "productVariations.id", "sharedProduct.variationId")
          .select([
            "sharedProduct.productId",
            "sharedProduct.variationId",
            "sharedProduct.cost",
            "products.title as productTitle",
            "productVariations.sku as variationSku",
          ])
          .where("sharedProduct.shareLinkId", "=", link.shareLinkId)
          .execute();

        const formattedProducts = products.map((p) => ({
          productId: p.productId,
          variationId: p.variationId,
          title: p.variationId ? `${p.productTitle} - ${p.variationSku}` : p.productTitle,
          cost: p.cost,
        }));

        return {
          shareLinkId: link.shareLinkId,
          warehouseId: link.warehouseId,
          warehouseName: link.warehouseName,
          token: link.token,
          status: link.status,
          recipients: recipients.map((r) => ({
            userId: r.recipientUserId,
            email: r.email,
            name: r.name,
          })),
          products: formattedProducts,
          createdAt: link.createdAt,
        };
      })
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("[GET /api/users/me/share-links] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
    const { shareLinkId } = await req.json();
    if (!shareLinkId) {
      return NextResponse.json({ error: "Share link ID is required" }, { status: 400 });
    }

    // Verify the share link exists and belongs to the user
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .select("id")
      .where("id", "=", shareLinkId)
      .where("creatorUserId", "=", userId)
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found or you are not the creator" }, { status: 404 });
    }

    // Step 1: Delete all sharedProductMapping and sharedVariationMapping entries for the share link
    const mappings = await db
      .selectFrom("sharedProductMapping")
      .select(["sourceProductId", "targetProductId"])
      .where("shareLinkId", "=", shareLinkId)
      .execute();

      const targetProductIds = mappings.map((m) => m.targetProductId);
    
      if (targetProductIds.length) {
        await propagateDeleteDeep(db, targetProductIds);          // <── ADD
      }

    await db
      .deleteFrom("sharedProductMapping")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    console.log(`[CLEANUP] Deleted all sharedProductMapping entries for shareLinkId: ${shareLinkId}`);

    await db
      .deleteFrom("sharedVariationMapping")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    console.log(`[CLEANUP] Deleted all sharedVariationMapping entries for shareLinkId: ${shareLinkId}`);

    // Step 2: Fetch all recipients of the share link and clean up their products
    const recipients = await db
      .selectFrom("warehouseShareRecipient")
      .select("recipientUserId")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    const recipientUserIds = recipients.map((r) => r.recipientUserId);

    if (recipientUserIds.length > 0) {
      console.log(
        `[CLEANUP] Identified ${recipientUserIds.length} recipients for share link ${shareLinkId}: ${recipientUserIds.join(", ")}`
      );

      for (const recipientUserId of recipientUserIds) {
        console.log(`[CLEANUP] Processing recipient: ${recipientUserId}`);

        // Find the tenant of the recipient
        const recipientTenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", recipientUserId)
          .executeTakeFirst();

        if (!recipientTenant) {
          console.log(`[CLEANUP] No tenant found for recipientUserId: ${recipientUserId}, skipping`);
          continue;
        }

        if (targetProductIds.length === 0) {
          console.log(`[CLEANUP] No synced products found for shareLinkId: ${shareLinkId} for recipient: ${recipientUserId}`);
          continue;
        }

        console.log(
          `[CLEANUP] Found ${targetProductIds.length} synced products for recipient: ${recipientUserId}: ${targetProductIds.join(", ")}`
        );

        // Delete associated warehouseStock entries for these products
        await db
          .deleteFrom("warehouseStock")
          .where("productId", "in", targetProductIds)
          .where("tenantId", "=", recipientTenant.id)
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
          .where("tenantId", "=", recipientTenant.id)
          .execute();
        console.log(`[CLEANUP] Deleted products: ${targetProductIds.join(", ")}`);
      }
    }

    // Step 3: Delete related recipients and products
    await db.deleteFrom("warehouseShareRecipient").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("sharedProduct").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("warehouseShareLink").where("id", "=", shareLinkId).execute();

    return NextResponse.json({ message: "Share link deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/users/me/share-links] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}