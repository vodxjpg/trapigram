import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const categoryUpdateSchema = z.object({
  name: z.string().min(1, { message: "Name is required." }).optional(),
  slug: z.string().min(1, { message: "Slug is required." }).optional(),
  image: z.string().nullable().optional(),
  order: z.number().int().optional(),
  parentId: z.string().nullable().optional(),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
    }
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session:", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (fallback):", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }

  try {
    const { id } = await params;
    const query = `
      SELECT pc.id, pc.name, pc.slug, pc.image, pc."order", pc."parentId", pc."organizationId", pc."createdAt", pc."updatedAt",
             COUNT(pcp."productId") as product_count,
             json_agg(
               json_build_object(
                 'id', sub_pc.id,
                 'name', sub_pc.name,
                 'slug', sub_pc.slug,
                 'image', sub_pc.image,
                 'order', sub_pc."order",
                 'parentId', sub_pc."parentId",
                 'createdAt', sub_pc."createdAt",
                 'updatedAt', sub_pc."updatedAt"
               )
             ) FILTER (WHERE sub_pc.id IS NOT NULL) as children
      FROM "productCategories" pc
      LEFT JOIN "productCategoryProducts" pcp ON pc.id = pcp."categoryId"
      LEFT JOIN "productCategories" sub_pc ON pc.id = sub_pc."parentId"
      WHERE pc.id = $1 AND pc."organizationId" = $2
      GROUP BY pc.id, pc.name, pc.slug, pc.image, pc."order", pc."parentId", pc."organizationId", pc."createdAt", pc."updatedAt"
    `;
    const result = await pool.query(query, [id, organizationId]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    const category = {
      ...result.rows[0],
      _count: { products: Number(result.rows[0].product_count) || 0 },
      children: result.rows[0].children === null ? [] : result.rows[0].children,
    };

    return NextResponse.json(category);
  } catch (error: any) {
    console.error("[GET /api/product-categories/[id]] error:", error);
    return NextResponse.json({ error: "Failed to fetch category" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
    }
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session:", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (fallback):", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const parsedCategory = categoryUpdateSchema.parse(body);

    if (parsedCategory.slug) {
      const slugCheck = await pool.query(
        `SELECT id FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2 AND id != $3`,
        [parsedCategory.slug, organizationId, id]
      );
      if (slugCheck.rows.length > 0) {
        return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(parsedCategory)) {
      if (value !== undefined) {
        updates.push(`"${key}" = $${paramIndex++}`);
        values.push(value === null ? null : value);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No fields provided to update" }, { status: 400 });
    }

    values.push(id, organizationId);
    const query = `
      UPDATE "productCategories"
      SET ${updates.join(", ")}, "updatedAt" = NOW()
      WHERE id = $${paramIndex++} AND "organizationId" = $${paramIndex}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error: any) {
    console.error("[PATCH /api/product-categories/[id]] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
    if (!organizationId) {
      return NextResponse.json(
        { error: "Organization ID is required in query parameters" },
        { status: 400 }
      );
    }
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session:", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (fallback):", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  }

  try {
    const { id } = await params;

    // Start a transaction to update children and delete the parent
    await pool.query("BEGIN");

    // Set children's parentId to null (make them orphans)
    const updateChildrenQuery = `
      UPDATE "productCategories"
      SET "parentId" = NULL, "updatedAt" = NOW()
      WHERE "parentId" = $1 AND "organizationId" = $2
    `;
    await pool.query(updateChildrenQuery, [id, organizationId]);

    // Delete the parent category
    const deleteQuery = `
      DELETE FROM "productCategories"
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const result = await pool.query(deleteQuery, [id, organizationId]);

    if (result.rows.length === 0) {
      await pool.query("ROLLBACK");
      return NextResponse.json({ error: "Category not found" }, { status: 404 });
    }

    await pool.query("COMMIT");
    return NextResponse.json({ message: "Category deleted successfully, subcategories orphaned" });
  } catch (error: any) {
    await pool.query("ROLLBACK");
    console.error("[DELETE /api/product-categories/[id]] error:", error);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}