import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;

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
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const userId = session.user.id;

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

    // Delete related recipients and products
    await db.deleteFrom("warehouseShareRecipient").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("sharedProduct").where("shareLinkId", "=", shareLinkId).execute();
    await db.deleteFrom("warehouseShareLink").where("id", "=", shareLinkId).execute();

    return NextResponse.json({ message: "Share link deleted successfully" }, { status: 200 });
  } catch (error) {
    console.error("[DELETE /api/users/me/share-links] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}