import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

// Schema for product creation/update
const productSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1, "SKU is required").optional(), // Made optional for auto-generation
  status: z.enum(["published", "draft"]),
  productType: z.enum(["simple", "variable"]),
  categories: z.array(z.string()).optional(),
  regularPrice: z.number().min(0, "Price must be a positive number"),
  salePrice: z.number().min(0, "Sale price must be a positive number").nullable().optional(),
  allowBackorders: z.boolean().default(false),
  manageStock: z.boolean().default(false),
  stockData: z.record(z.string(), z.record(z.string(), z.number())).nullable().optional(),
  attributes: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        terms: z.array(z.object({ id: z.string(), name: z.string() })),
        useForVariations: z.boolean(),
        selectedTerms: z.array(z.string()),
      }),
    )
    .optional(),
  variations: z
    .array(
      z.object({
        id: z.string(),
        attributes: z.record(z.string(), z.string()),
        sku: z.string(),
        regularPrice: z.number(),
        salePrice: z.number().nullable(),
        stock: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      }),
    )
    .optional(),
});

// GET handler for fetching paginated products
export async function GET(req: NextRequest) {
  try {
    // Authenticate the request
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const organizationId = session.session.activeOrganizationId;
    const userId = session.user.id;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }

    // Get pagination and search parameters
    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get("page") || "1");
    const pageSize = parseInt(searchParams.get("pageSize") || "10");
    const search = searchParams.get("search") || "";
    const categoryId = searchParams.get("categoryId") || "";

    // Fetch tenant
    const tenant = await db
      .selectFrom("tenant")
      .select(["id"])
      .where("ownerUserId", "=", userId)
      .executeTakeFirst();

    if (!tenant) {
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    }

    const tenantId = tenant.id;

    // Build products query
    let productsQuery = db
      .selectFrom("products")
      .select([
        "id",
        "title",
        "description",
        "image",
        "sku",
        "status",
        "productType",
        "regularPrice",
        "salePrice",
        "allowBackorders",
        "manageStock",
        "stockData",
        "stockStatus",
        "createdAt",
        "updatedAt",
      ])
      .where("organizationId", "=", organizationId)
      .where("tenantId", "=", tenantId);

    // Apply search filter
    if (search) {
      productsQuery = productsQuery.where("title", "ilike", `%${search}%`);
    }

    // Apply category filter
    if (categoryId) {
      productsQuery = productsQuery
        .innerJoin("productCategory", "productCategory.productId", "products.id")
        .where("productCategory.categoryId", "=", categoryId);
    }

    // Execute products query
    const products = await productsQuery
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();

    // Fetch associated categories
    const productIds = products.map((p) => p.id);
    const productCategories = productIds.length
      ? await db
          .selectFrom("productCategory")
          .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
          .select(["productCategory.productId", "productCategories.name"])
          .where("productCategory.productId", "in", productIds)
          .execute()
      : [];

    // Map categories to products
    const productsWithCategories = products.map((product) => ({
      ...product,
      stockData: product.stock_data,
      categories: productCategories
        .filter((pc) => pc.productId === product.id)
        .map((pc) => pc.name),
    }));

    // Fetch total count for pagination
    let totalCountQuery = db
      .selectFrom("products")
      .select(db.fn.count("id").as("total"))
      .where("organizationId", "=", organizationId)
      .where("tenantId", "=", tenantId);

    if (search) {
      totalCountQuery = totalCountQuery.where("title", "ilike", `%${search}%`);
    }

    if (categoryId) {
      totalCountQuery = totalCountQuery
        .innerJoin("productCategory", "productCategory.productId", "products.id")
        .where("productCategory.categoryId", "=", categoryId);
    }

    const totalCountResult = await totalCountQuery.executeTakeFirst();
    const total = Number(totalCountResult?.total || 0);

    return NextResponse.json({
      products: productsWithCategories,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    console.error("[PRODUCTS_GET]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;
  let userId: string;

  // Authenticate the request
  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    userId = session?.user?.id || "";
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = session.session.activeOrganizationId;
    userId = session.user.id;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
    }
    organizationId = session.session.activeOrganizationId;
    userId = session.user.id;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }

  try {
    const body = await req.json();
    let parsedProduct = productSchema.parse(body);

    // Get tenant ID for the user
    const tenant = await db
      .selectFrom("tenant")
      .select(["id"])
      .where("ownerUserId", "=", userId)
      .executeTakeFirst();

    if (!tenant) {
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    }

    const tenantId = tenant.id;

    // Handle SKU: validate or auto-generate
    let finalSku = parsedProduct.sku;
    if (!finalSku) {
      let isUnique = false;
      do {
        finalSku = `SKU-${uuidv4().slice(0, 8)}`;
        const existing = await db
          .selectFrom("products")
          .select("id")
          .where("sku", "=", finalSku)
          .where("organizationId", "=", organizationId)
          .executeTakeFirst();
        isUnique = !existing;
      } while (!isUnique);
    } else {
      const existing = await db
        .selectFrom("products")
        .select("id")
        .where("sku", "=", finalSku)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      if (existing) {
        return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
      }
    }
    parsedProduct = { ...parsedProduct, sku: finalSku };

    // Validate categories if provided
    if (parsedProduct.categories && parsedProduct.categories.length > 0) {
      const existingCategories = await db
        .selectFrom("productCategories")
        .select("id")
        .where("organizationId", "=", organizationId)
        .execute();
      const existingCategoryIds = existingCategories.map((cat) => cat.id);
      const invalidCategories = parsedProduct.categories.filter((catId) => !existingCategoryIds.includes(catId));
      if (invalidCategories.length > 0) {
        return NextResponse.json(
          { error: `The following category IDs do not exist: ${invalidCategories.join(", ")}` },
          { status: 400 }
        );
      }
    }

    // Generate product ID
    const productId = uuidv4();

    // Insert the product
    await db
      .insertInto("products")
      .values({
        id: productId,
        organizationId: organizationId,
        tenantId: tenantId,
        title: parsedProduct.title,
        description: parsedProduct.description || null,
        image: parsedProduct.image || null,
        sku: parsedProduct.sku,
        status: parsedProduct.status,
        productTyoe: parsedProduct.productType,
        regularPrice: parsedProduct.regularPrice,
        salePrice: parsedProduct.salePrice || null,
        allowBackorders: parsedProduct.allowBackorders,
        manageStock: parsedProduct.manageStock,
        stockData: parsedProduct.stockData ? JSON.stringify(parsedProduct.stockData) : null,
        stockStatus: parsedProduct.manageStock ? "managed" : "unmanaged",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .execute();

    // Insert variations (for variable products)
    if (
      parsedProduct.productType === "variable" &&
      parsedProduct.variations &&
      parsedProduct.variations.length > 0
    ) {
      for (const variation of parsedProduct.variations) {
        // Validate variation SKU
        const existingVariationSku = await db
          .selectFrom("productVariations")
          .select("id")
          .where("sku", "=", variation.sku)
          .where("productId", "!=", productId)
          .executeTakeFirst();
        if (existingVariationSku) {
          return NextResponse.json({ error: `Variation SKU ${variation.sku} already exists` }, { status: 400 });
        }

        await db
          .insertInto("productVariations")
          .values({
            id: variation.id,
            producftID: productId,
            attributes: JSON.stringify(variation.attributes),
            sku: variation.sku,
            regularPrice: variation.regularPrice,
            salePrice: variation.salePrice,
            stock: variation.stock ? JSON.stringify(variation.stock) : null,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          .execute();
      }
    }

    // Insert attributes
    if (parsedProduct.attributes && parsedProduct.attributes.length > 0) {
      for (const attribute of parsedProduct.attributes) {
        for (const termId of attribute.selectedTerms) {
          await db
            .insertInto("productAttributeValues")
            .values({
              productId: productId,
              attributeId: attribute.id,
              termId: termId,
            })
            .execute();
        }
      }
    }

    // Insert product-category relationships
    if (parsedProduct.categories && parsedProduct.categories.length > 0) {
      for (const categoryId of parsedProduct.categories) {
        await db
          .insertInto("productCategory")
          .values({
            productId: productId,
            categoryId: categoryId,
          })
          .execute();
      }
    }

    return NextResponse.json(
      {
        product: {
          id: productId,
          ...parsedProduct,
          organizationId,
          tenantId,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[PRODUCTS_POST]", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}