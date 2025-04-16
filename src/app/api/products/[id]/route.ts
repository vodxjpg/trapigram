import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// Schema for product update using camelCase
const productUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1, "SKU is required").optional(),
  status: z.enum(["published", "draft"]).optional(),
  productType: z.enum(["simple", "variable"]).optional(),
  categories: z.array(z.string()).optional(),
  // Allow regularPrice to be null for variable products
  regularPrice: z.number().min(0, "Price must be a positive number").nullable().optional(),
  salePrice: z.number().min(0, "Sale price must be a positive number").nullable().optional(),
  allowBackorders: z.boolean().optional(),
  manageStock: z.boolean().optional(),
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
        regularPrice: z.number(), // for variations
        salePrice: z.number().nullable(),
        stock: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      }),
    )
    .optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Authenticate
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    const { id } = await params;

    // Fetch the product using camelCase column names
    const product = await db
      .selectFrom("products")
      .selectAll()
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();
    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Fetch category mappings for the product
    const categoryRows = await db
      .selectFrom("productCategory")
      .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
      .select(["productCategories.id", "productCategories.name"])
      .where("productCategory.productId", "=", id)
      .execute();

    // Fetch attribute mappings for the product
    const attributeRows = await db
      .selectFrom("productAttributeValues")
      .innerJoin("productAttributes", "productAttributes.id", "productAttributeValues.attributeId")
      .innerJoin("productAttributeTerms", "productAttributeTerms.id", "productAttributeValues.termId")
      .select([
        "productAttributes.id as attributeId",
        "productAttributes.name as attributeName",
        "productAttributeTerms.id as termId",
        "productAttributeTerms.name as termName",
      ])
      .where("productAttributeValues.productId", "=", id)
      .execute();

    // Fetch variations if the product is variable (using camelCase key "productId")
    const variations = product.productType === "variable"
      ? await db
          .selectFrom("productVariations")
          .selectAll()
          .where("productId", "=", id)
          .execute()
      : [];

    // Build attributes array from attributeRows
    const attributes = attributeRows.reduce((acc, row) => {
      const existing = acc.find((a) => a.id === row.attributeId);
      if (existing) {
        existing.terms.push({ id: row.termId, name: row.termName });
        existing.selectedTerms.push(row.termId);
      } else {
        acc.push({
          id: row.attributeId,
          name: row.attributeName,
          terms: [{ id: row.termId, name: row.termName }],
          useForVariations: variations.length > 0,
          selectedTerms: [row.termId],
        });
      }
      return acc;
    }, [] as any[]);

    return NextResponse.json({
      product: {
        ...product,
        // Set stockStatus based on manageStock field
        stockStatus: product.manageStock ? "managed" : "unmanaged",
        stockData: product.stockData,
        // Use category IDs from mapping if available; fallback to product.categories if necessary
        categories: categoryRows.length ? categoryRows.map((r) => r.id) : (product.categories || []),
        attributes,
        variations: variations.map((v) => ({
          id: v.id,
          attributes: v.attributes,
          sku: v.sku,
          regularPrice: v.regularPrice,
          salePrice: v.salePrice,
          stock: v.stock,
        })),
      },
    });
  } catch (error) {
    const { id } = await params;
    console.error(`[PRODUCT_GET_${id}]`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    const { id } = await params;
    const body = await req.json();
    const parsedUpdate = productUpdateSchema.parse(body);

    // Check if product exists
    const existingProduct = await db
      .selectFrom("products")
      .select("id")
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Validate SKU if provided
    if (parsedUpdate.sku) {
      const existingSku = await db
        .selectFrom("products")
        .select("id")
        .where("sku", "=", parsedUpdate.sku)
        .where("id", "!=", id)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      if (existingSku) {
        return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
      }
    }

    // Validate categories if provided
    if (parsedUpdate.categories && parsedUpdate.categories.length > 0) {
      const existingCategories = await db
        .selectFrom("productCategories")
        .select("id")
        .where("organizationId", "=", organizationId)
        .execute();
      const existingCategoryIds = existingCategories.map((cat) => cat.id);
      const invalidCategories = parsedUpdate.categories.filter((catId) => !existingCategoryIds.includes(catId));
      if (invalidCategories.length > 0) {
        return NextResponse.json(
          { error: `The following category IDs do not exist: ${invalidCategories.join(", ")}` },
          { status: 400 },
        );
      }
    }

    // Update the product with new camelCase column names
    await db
      .updateTable("products")
      .set({
        title: parsedUpdate.title,
        description: parsedUpdate.description,
        image: parsedUpdate.image,
        sku: parsedUpdate.sku,
        status: parsedUpdate.status,
        productType: parsedUpdate.productType,
        regularPrice: parsedUpdate.regularPrice,
        salePrice: parsedUpdate.salePrice,
        allowBackorders: parsedUpdate.allowBackorders,
        manageStock: parsedUpdate.manageStock,
        stockData: parsedUpdate.stockData ? JSON.stringify(parsedUpdate.stockData) : undefined,
        stockStatus: parsedUpdate.manageStock ? "managed" : "unmanaged",
        updatedAt: new Date(),
      })
      .where("id", "=", id)
      .execute();

    // Update product-category relationships
    if (parsedUpdate.categories) {
      await db.deleteFrom("productCategory").where("productId", "=", id).execute();
      for (const categoryId of parsedUpdate.categories) {
        await db
          .insertInto("productCategory")
          .values({ productId: id, categoryId })
          .execute();
      }
    }

    // Update product attribute mappings
    if (parsedUpdate.attributes) {
      await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
      for (const attribute of parsedUpdate.attributes) {
        for (const termId of attribute.selectedTerms) {
          await db
            .insertInto("productAttributeValues")
            .values({
              productId: id,
              attributeId: attribute.id,
              termId,
            })
            .execute();
        }
      }
    }

    // Update product variations (for variable products)
    if (parsedUpdate.variations && parsedUpdate.productType === "variable") {
      // Delete all variations for this product (using camelCase)
      await db.deleteFrom("productVariations").where("productId", "=", id).execute();
      for (const variation of parsedUpdate.variations) {
        const existingVariationSku = await db
          .selectFrom("productVariations")
          .select("id")
          .where("sku", "=", variation.sku)
          .where("id", "!=", id)
          .executeTakeFirst();
        if (existingVariationSku) {
          return NextResponse.json({ error: `Variation SKU ${variation.sku} already exists` }, { status: 400 });
        }
        await db
          .insertInto("productVariations")
          .values({
            id: variation.id,
            productId: id, // using camelCase column name
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

    return NextResponse.json({
      product: {
        id,
        ...parsedUpdate,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const { id } = await params;
    console.error(`[PRODUCT_PATCH_${id}]`, error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    }
    const organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
    const { id } = await params;
    const existingProduct = await db
      .selectFrom("products")
      .select("id")
      .where("id", "=", id)
      .where("organizationId", "=", organizationId)
      .executeTakeFirst();
    if (!existingProduct) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }
    await db.deleteFrom("productCategory").where("productId", "=", id).execute();
    await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
    await db.deleteFrom("productVariations").where("id", "=", id).execute();
    await db.deleteFrom("products").where("id", "=", id).execute();
    return NextResponse.json({ message: "Product deleted successfully" });
  } catch (error) {
    const { id } = await params;
    console.error(`[PRODUCT_DELETE_${id}]`, error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
