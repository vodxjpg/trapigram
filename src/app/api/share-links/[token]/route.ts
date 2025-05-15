import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest, { params }: { params: { token: string } }) {

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;
  const token = params.token;

  try {

    // Fetch share link
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .select(["id", "warehouseId", "creatorUserId", "status"])
      .where("token", "=", token)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json({ error: "Share link not found or inactive" }, { status: 404 });
    }

    // Verify user is a recipient
    const recipient = await db
      .selectFrom("warehouseShareRecipient")
      .select("id")
      .where("shareLinkId", "=", shareLink.id)
      .where("recipientUserId", "=", userId)
      .executeTakeFirst();

    if (!recipient) {
      return NextResponse.json({ error: "You are not a recipient of this share link" }, { status: 403 });
    }

    // Fetch warehouse details
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "name", "countries"])
      .where("id", "=", shareLink.warehouseId)
      .executeTakeFirst();

    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    // Fetch shared products
    const sharedProducts = await db
      .selectFrom("sharedProduct")
      .innerJoin("products", "products.id", "sharedProduct.productId")
      .leftJoin("productVariations", "productVariations.id", "sharedProduct.variationId")
      .select([
        "sharedProduct.productId",
        "sharedProduct.variationId",
        "sharedProduct.cost",
        "products.title as productTitle",
        "products.productType",
        "productVariations.sku as variationSku",
      ])
      .where("sharedProduct.shareLinkId", "=", shareLink.id)
      .execute();

    // Fetch creator details
    const creator = await db
      .selectFrom("user")
      .select(["id", "email", "name"])
      .where("id", "=", shareLink.creatorUserId)
      .executeTakeFirst();

    return NextResponse.json(
      {
        shareLink: {
          id: shareLink.id,
          token,
          warehouse: {
            id: warehouse.id,
            name: warehouse.name,
            countries: JSON.parse(warehouse.countries),
          },
          creator: {
            id: creator?.id,
            email: creator?.email,
            name: creator?.name,
          },
          products: sharedProducts.map((p) => ({
            productId: p.productId,
            variationId: p.variationId,
            title: p.variationId ? `${p.productTitle} - ${p.variationSku}` : p.productTitle,
            cost: p.cost,
          })),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/share-links/:token] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}