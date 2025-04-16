import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// Schema for product update
const productUpdateSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().optional(),
  image: z.string().nullable().optional(),
  sku: z.string().min(1, "SKU is required").optional(),
  status: z.enum(["published", "draft"]).optional(),
  productType: z.enum(["simple", "variable"]).optional(),
  categories: z.array(z.string()).optional(),
  regularPrice: z.number().min(0, "Price must be a positive number").optional(),
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
        regularPrice: z.number(),
        salePrice: z.number().nullable(),
        stock: z.record(z.string(), z.record(z.string(), z.number())).optional(),
      }),
    )
    .optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    // Fetch the product
    const product = await db
      .selectFrom("products")
      .selectAll()
      .where("id", "=", id)
      .where("organization_id", "=", organizationId)
      .executeTakeFirst();

    if (!product) {
      return NextResponse.json({ error: "Product not found" }, { status: 404 });
    }

    // Fetch category mappings
    const categories = await db
      .selectFrom("productCategory")
      .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
      .select(["productCategories.id", "productCategories.name"])
      .where("productCategory.productId", "=", id)
      .execute();

    // Fetch attribute values
    const attributes = await db
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

    // Fetch variations (if variable product)
    const variations = product.product_type === "variable"
      ? await db
          .selectFrom("productVariations")
          .selectAll()
          .where("product_id", "=", id)
          .execute()
      : [];

    return NextResponse.json({
      product: {
        ...product,
        stockData: product.stock_data,
        // If join returns rows, use them; otherwise fallback to product.categories
        categories: categories.length ? categories.map((c) => c.id) : (product.categories || []),
        attributes: attributes.reduce((acc, attr) => {
          const existing = acc.find((a) => a.id === attr.attributeId);
          if (existing) {
            existing.terms.push({ id: attr.termId, name: attr.termName });
            existing.selectedTerms.push(attr.termId);
          } else {
            acc.push({
              id: attr.attributeId,
              name: attr.attributeName,
              terms: [{ id: attr.termId, name: attr.termName }],
              useForVariations: variations.length > 0,
              selectedTerms: [attr.termId],
            });
          }
          return acc;
        }, [] as any[]),
        variations: variations.map((v) => ({
          id: v.id,
          attributes: v.attributes,
          sku: v.sku,
          regularPrice: v.regular_price,
          salePrice: v.sale_price,
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
      .where("organization_id", "=", organizationId)
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
        .where("organization_id", "=", organizationId)
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
          { status: 400 }
        );
      }
    }

    // Update product
    await db
      .updateTable("products")
      .set({
        title: parsedUpdate.title,
        description: parsedUpdate.description,
        image: parsedUpdate.image,
        sku: parsedUpdate.sku,
        status: parsedUpdate.status,
        product_type: parsedUpdate.productType,
        regular_price: parsedUpdate.regularPrice,
        sale_price: parsedUpdate.salePrice,
        allow_backorders: parsedUpdate.allowBackorders,
        manage_stock: parsedUpdate.manageStock,
        stock_data: parsedUpdate.stockData ? JSON.stringify(parsedUpdate.stockData) : undefined,
        stock_status: parsedUpdate.manageStock ? "managed" : "unmanaged",
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();

    // Update categories
    if (parsedUpdate.categories) {
      await db.deleteFrom("productCategory").where("productId", "=", id).execute();
      for (const categoryId of parsedUpdate.categories) {
        await db
          .insertInto("productCategory")
          .values({ productId: id, categoryId })
          .execute();
      }
    }

    // Update attributes
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

    // Update variations
    if (parsedUpdate.variations && parsedUpdate.productType === "variable") {
      await db.deleteFrom("productVariations").where("id", "=", id).execute();
      for (const variation of parsedUpdate.variations) {
        // Validate variation SKU
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
            product_id: id,
            attributes: JSON.stringify(variation.attributes),
            sku: variation.sku,
            regular_price: variation.regularPrice,
            sale_price: variation.salePrice,
            stock: variation.stock ? JSON.stringify(variation.stock) : null,
            created_at: new Date(),
            updated_at: new Date(),
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
      .where("organization_id", "=", organizationId)
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
