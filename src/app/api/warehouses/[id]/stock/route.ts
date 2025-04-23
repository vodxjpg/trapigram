import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

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
    console.error("[GET /api/warehouses/:id/stock] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}