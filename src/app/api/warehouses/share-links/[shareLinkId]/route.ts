// src/app/api/warehouses/share-links/[shareLinkId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const costSchema = z
  .record(z.string(), z.number().positive("Cost must be a positive number"))
  .optional();

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

/* ▶ helper: safely parse columns that may already be JSON objects */
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

/* ──────────────────────────────────────────────────────────────────────── */
/*  GET                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ shareLinkId: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    const userId = session.user.id;

    const { shareLinkId } = await context.params;

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

    if (!shareLink)
      return NextResponse.json(
        { error: "Share link not found, inactive, or you are not the creator" },
        { status: 404 },
      );

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
        "productVariations.attributes as variationAttributes",
      ])
      .where("sharedProduct.shareLinkId", "=", shareLinkId)
      .execute();

    /* Build term-id → term-name map */
    const vAttrIds = new Set<string>();
    products.forEach((p) => {
      const attrs = safeParseJSON<Record<string, string>>(p.variationAttributes);
      Object.values(attrs).forEach((id) => vAttrIds.add(id));
    });
    const termMap =
      vAttrIds.size > 0
        ? new Map(
            (
              await db
                .selectFrom("productAttributeTerms")
                .select(["id", "name"])
                .where("id", "in", [...vAttrIds])
                .execute()
            ).map((t) => [t.id, t.name]),
          )
        : new Map();

    const formattedProducts = products.map((p) => {
      let suffix = "";
      if (p.variationId) {
        const attrs = safeParseJSON<Record<string, string>>(p.variationAttributes);
        suffix = Object.values(attrs)
          .map((tid) => termMap.get(tid) ?? tid)
          .join(" / ");
      }
      return {
        id: p.id,
        productId: p.productId,
        variationId: p.variationId,
        title: p.variationId ? `${p.productTitle} - ${suffix}` : p.productTitle,
        cost: p.cost,
        productType: p.productType,
      };
    });

    return NextResponse.json(
      {
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
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GET /api/warehouses/share-links/[shareLinkId]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}


/* ──────────────────────────────────────────────────────────────────────── */
/*  PUT                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ shareLinkId: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    const userId = session.user.id;
    const { shareLinkId } = await context.params;

    const body   = await req.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    const { recipientUserIds, products } = parsed.data;

    /* ---------- verify link & warehouse ---------- */
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select(["warehouseShareLink.id", "warehouseShareLink.warehouseId", "warehouse.countries"])
      .where("warehouseShareLink.id", "=", shareLinkId)
      .where("warehouseShareLink.creatorUserId", "=", userId)
      .where("warehouseShareLink.status", "=", "active")
      .executeTakeFirst();
    if (!shareLink)
      return NextResponse.json(
        { error: "Share link not found, inactive, or you are not the creator" },
        { status: 404 },
      );
    const warehouseId       = shareLink.warehouseId;
    const warehouseCountries = JSON.parse(shareLink.countries) as string[];

    /* ── entire original logic preserved ─────────────────────────────── */

    // Validate recipient users
    const validUsers = await db
      .selectFrom("user")
      .select("id")
      .where("id", "in", recipientUserIds)
      .execute();
    if (validUsers.length !== recipientUserIds.length) {
      return NextResponse.json(
        { error: "One or more recipient user IDs are invalid" },
        { status: 400 }
      );
    }

    // Validate products, variations, stock, and costs
    for (const { productId, variationId, cost } of products) {
      const product = await db
        .selectFrom("products")
        .select(["id", "cost", "productType"])
        .where("id", "=", productId)
        .executeTakeFirst();
      if (!product) {
        return NextResponse.json(
          { error: `Product ${productId} not found` },
          { status: 400 }
        );
      }

      const productCost =
        typeof product.cost === "string"
          ? JSON.parse(product.cost)
          : product.cost;

      let baseCost: Record<string, number> = productCost;
      if (variationId) {
        if (product.productType !== "variable") {
          return NextResponse.json(
            { error: `Product ${productId} is not variable` },
            { status: 400 }
          );
        }
        const variation = await db
          .selectFrom("productVariations")
          .select(["id", "cost"])
          .where("id", "=", variationId)
          .where("productId", "=", productId)
          .executeTakeFirst();
        if (!variation) {
          return NextResponse.json(
            { error: `Variation ${variationId} not found` },
            { status: 400 }
          );
        }
        baseCost =
          typeof variation.cost === "string"
            ? JSON.parse(variation.cost)
            : variation.cost;
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
          {
            error: `No stock available for product ${productId}${
              variationId ? ` variation ${variationId}` : ""
            }`,
          },
          { status: 400 }
        );
      }

      if (cost) {
        for (const [country, sharedCost] of Object.entries(cost)) {
          if (!warehouseCountries.includes(country)) {
            return NextResponse.json(
              { error: `Country ${country} not supported by warehouse` },
              { status: 400 }
            );
          }
          if (!(country in baseCost)) {
            return NextResponse.json(
              { error: `Base cost not defined for country ${country}` },
              { status: 400 }
            );
          }
          if (sharedCost <= baseCost[country]) {
            return NextResponse.json(
              {
                error: `Shared cost for ${country} must be higher than base cost (${baseCost[country]})`,
              },
              { status: 400 }
            );
          }
          if (!stock.some((s) => s.country === country && s.quantity > 0)) {
            return NextResponse.json(
              {
                error: `No stock available for ${country} for product ${productId}${
                  variationId ? ` variation ${variationId}` : ""
                }`,
              },
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
    const recipientRows = recipientUserIds.map((uid) => ({
      id: generateId("WSR"),
      shareLinkId,
      recipientUserId: uid,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("warehouseShareRecipient").values(recipientRows).execute();

    await db.deleteFrom("sharedProduct").where("shareLinkId", "=", shareLinkId).execute();
    const sharedRows = products.map((p) => ({
      id: generateId("SP"),
      shareLinkId,
      productId: p.productId,
      variationId: p.variationId,
      cost: p.cost || {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    await db.insertInto("sharedProduct").values(sharedRows).execute();

    await db
      .updateTable("warehouseShareLink")
      .set({ updatedAt: new Date() })
      .where("id", "=", shareLinkId)
      .execute();

    /* ------------------------------------------------------------------ */
    /*  PROPAGATE CUSTOM COSTS                                            */
    /* ------------------------------------------------------------------ */
    /* product-level overrides */
    const prodOverrides = sharedRows.filter((r) => !r.variationId && Object.keys(r.cost).length);
    if (prodOverrides.length) {
      const prodMaps = await db
        .selectFrom("sharedProductMapping")
        .select(["sourceProductId", "targetProductId"])
        .where("shareLinkId", "=", shareLinkId)
        .where("sourceProductId", "in", prodOverrides.map((r) => r.productId))
        .execute();

      for (const src of prodOverrides) {
        const map = prodMaps.find((m) => m.sourceProductId === src.productId);
        if (!map) continue;
        const tgt = await db
          .selectFrom("products")
          .select("cost")
          .where("id", "=", map.targetProductId)
          .executeTakeFirst();
        const current =
          tgt?.cost && typeof tgt.cost === "string" ? JSON.parse(tgt.cost) : tgt?.cost || {};
        await db
          .updateTable("products")
          .set({ cost: { ...current, ...src.cost }, updatedAt: new Date() })
          .where("id", "=", map.targetProductId)
          .execute();
      }
    }

    /* variation-level overrides */
    const varOverrides = sharedRows.filter((r) => r.variationId && Object.keys(r.cost).length);
    for (const src of varOverrides) {
      const vMap = await db
        .selectFrom("sharedVariationMapping")
        .select("targetVariationId")
        .where("shareLinkId", "=", shareLinkId)
        .where("sourceProductId", "=", src.productId)
        .where("sourceVariationId", "=", src.variationId!)
        .executeTakeFirst();
      if (!vMap) continue;

      const tgtVar = await db
        .selectFrom("productVariations")
        .select("cost")
        .where("id", "=", vMap.targetVariationId)
        .executeTakeFirst();
      const current =
        tgtVar?.cost && typeof tgtVar.cost === "string" ? JSON.parse(tgtVar.cost) : tgtVar?.cost || {};

      await db
        .updateTable("productVariations")
        .set({ cost: { ...current, ...src.cost }, updatedAt: new Date() })
        .where("id", "=", vMap.targetVariationId)
        .execute();
    }

    return NextResponse.json({ message: "Share link updated successfully" }, { status: 200 });
  } catch (error) {
    console.error("[PUT /api/warehouses/share-links/[shareLinkId]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ shareLinkId: string }> },
) {
  try {
    /* ----------------------------- auth ------------------------------ */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json(
        { error: "Unauthorized: No session found" },
        { status: 401 },
      );
    const userId = session.user.id;
    const { shareLinkId } = await context.params;

    /* ----------------------------- verify link ----------------------- */
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .select(["id"])
      .where("id", "=", shareLinkId)
      .where("creatorUserId", "=", userId)
      .where("status", "=", "active")
      .executeTakeFirst();

    if (!shareLink)
      return NextResponse.json(
        {
          error:
            "Share link not found, inactive, or you are not the creator",
        },
        { status: 404 },
      );

    /* ---------------------------------------------------------------- */
    /*  1. Collect mappings & target products                           */
    /* ---------------------------------------------------------------- */
    const mappings = await db
      .selectFrom("sharedProductMapping")
      .select(["sourceProductId", "targetProductId"])
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    const targetProductIds = mappings.map((m) => m.targetProductId);

    /* ---------------------------------------------------------------- */
    /*  2. Collect all recipients                                       */
    /* ---------------------------------------------------------------- */
    const recipients = await db
      .selectFrom("warehouseShareRecipient")
      .select("recipientUserId")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    const recipientUserIds = recipients.map((r) => r.recipientUserId);

    /* ---------------------------------------------------------------- */
    /*  3. Per-recipient deep cleanup (stock ▸ variations ▸ products)   */
    /* ---------------------------------------------------------------- */
    if (recipientUserIds.length && targetProductIds.length) {
      for (const recipientUserId of recipientUserIds) {
        const tenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", recipientUserId)
          .executeTakeFirst();
        if (!tenant) continue;

        /* wipe stock */
        await db
          .deleteFrom("warehouseStock")
          .where("productId", "in", targetProductIds)
          .where("tenantId", "=", tenant.id)
          .execute();

        /* wipe variations */
        await db
          .deleteFrom("productVariations")
          .where("productId", "in", targetProductIds)
          .execute();

        /* wipe products */
        await db
          .deleteFrom("products")
          .where("id", "in", targetProductIds)
          .where("tenantId", "=", tenant.id)
          .execute();
      }
    }

    /* ---------------------------------------------------------------- */
    /*  4. Remove mapping rows FIRST to keep FK constraints happy       */
    /* ---------------------------------------------------------------- */
    await db
      .deleteFrom("sharedVariationMapping")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    await db
      .deleteFrom("sharedProductMapping")
      .where("shareLinkId", "=", shareLinkId)
      .execute();

    /* ---------------------------------------------------------------- */
    /*  5. Remove sharedProduct + recipient rows + the link itself      */
    /* ---------------------------------------------------------------- */
    await db
      .deleteFrom("sharedProduct")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    await db
      .deleteFrom("warehouseShareRecipient")
      .where("shareLinkId", "=", shareLinkId)
      .execute();
    await db
      .deleteFrom("warehouseShareLink")
      .where("id", "=", shareLinkId)
      .execute();

    return NextResponse.json(
      { message: "Share link deleted successfully" },
      { status: 200 },
    );
  } catch (err) {
    console.error(
      "[DELETE /api/warehouses/share-links/[shareLinkId]]",
      err,
    );
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
