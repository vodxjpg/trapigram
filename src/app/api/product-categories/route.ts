import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Schema for POST requests (no organizationId in body)
const categorySchema = z.object({
  name: z.string().min(1, { message: "Name is required." }),
  slug: z.string().min(1, { message: "Slug is required." }),
  image: z.string().nullable().optional(),
  order: z.number().int().default(0),
  parentId: z.string().nullable().optional(),
});

// GET handler: Fetch product categories
export async function GET(req: NextRequest) {
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
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    }
  } else {
    // Fallback for UI requests using session cookie
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

  // Pagination and search parameters
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  // Query for total count
  let countQuery = `
    SELECT COUNT(*) FROM "productCategories"
    WHERE "organizationId" = $1
  `;
  const countValues: any[] = [organizationId];
  if (search) {
    countQuery += ` AND (name ILIKE $2 OR slug ILIKE $2)`;
    countValues.push(`%${search}%`);
  }

  // Main query for categories
  let query = `
    SELECT id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt"
    FROM "productCategories"
    WHERE "organizationId" = $1
  `;
  const values: any[] = [organizationId];
  if (search) {
    query += ` AND (name ILIKE $2 OR slug ILIKE $2)`;
    values.push(`%${search}%`);
  }
  query += `
    ORDER BY "order" ASC, "createdAt" DESC
    LIMIT $${values.length + 1} OFFSET $${values.length + 2}
  `;
  values.push(pageSize, (page - 1) * pageSize);

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const categories = result.rows;

    return NextResponse.json({
      categories,
      totalPages,
      currentPage: page,
    });
  } catch (error: any) {
    console.error("[GET /api/product-categories] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST handler: Create a new product category
export async function POST(req: NextRequest) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session:", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  } else {
    // Fallback for UI requests using session cookie
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (fallback):", session);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 403 });
    }
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) {
      return NextResponse.json({ error: "No active organization" }, { status: 400 });
    }
  }

  try {
    const body = await req.json();
    const parsedCategory = categorySchema.parse(body);
    const { name, slug, image, order, parentId } = parsedCategory;
    const categoryId = uuidv4();

    // Check for unique slug within the organization
    const slugCheck = await pool.query(
      `SELECT id FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2`,
      [slug, organizationId]
    );
    if (slugCheck.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    // Insert new category
    const insertQuery = `
      INSERT INTO "productCategories"(id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
      VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *
    `;
    const values = [categoryId, name, slug, image, order, parentId || null, organizationId];

    const result = await pool.query(insertQuery, values);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/product-categories] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}