// /src/app/api/share-links/[token]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ token: string }> } // Next 16: params is a Promise
) {
  const { token } = await context.params;

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
    // 1) Share link
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .select(["id", "warehouseId", "creatorUserId", "status"])
      .where("token", "=", token)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!shareLink) {
      return NextResponse.json(
        { error: "Share link not found or inactive" },
        { status: 404 }
      );
    }

    // 2) Recipient check
    const recipient = await db
      .selectFrom("warehouseShareRecipient")
      .select("id")
      .where("shareLinkId", "=", shareLink.id)
      .where("recipientUserId", "=", userId)
      .executeTakeFirst();

    if (!recipient) {
      return NextResponse.json(
        { error: "You are not a recipient of this share link" },
        { status: 403 }
      );
    }

    // 3) Warehouse details
    const warehouse = await db
      .selectFrom("warehouse")
      .select(["id", "name", "countries"])
      .where("id", "=", shareLink.warehouseId)
      .executeTakeFirst();

    if (!warehouse) {
      return NextResponse.json({ error: "Warehouse not found" }, { status: 404 });
    }

    const warehouseCountries =
      Array.isArray(warehouse.countries)
        ? warehouse.countries
        : (() => {
          try {
            return JSON.parse((warehouse as any).countries || "[]");
          } catch {
            return [];
          }
        })();

    // 4) Shared products
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

    const products = sharedProducts.map((p) => ({
      productId: p.productId,
      variationId: p.variationId,
      title: p.variationId ? `${p.productTitle} - ${p.variationSku}` : p.productTitle,
      cost:
        typeof p.cost === "string"
          ? (() => {
            try {
              return JSON.parse(p.cost as unknown as string);
            } catch {
              return p.cost;
            }
          })()
          : p.cost,
    }));

    // 5) Creator details
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
            countries: warehouseCountries,
          },
          creator: {
            id: creator?.id,
            email: creator?.email,
            name: creator?.name,
          },
          products,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("[GET /api/share-links/:token] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
