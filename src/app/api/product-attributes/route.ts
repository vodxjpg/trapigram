import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const attributeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");
  const page = Number(searchParams.get("page")) || 1;
  const pageSize = Number(searchParams.get("pageSize")) || 10;
  const search = searchParams.get("search") || "";

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    organizationId = explicitOrgId || "";
    if (!organizationId) return NextResponse.json({ error: "Organization ID required" }, { status: 400 });
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized: No session" }, { status: 403 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  const countQuery = `
    SELECT COUNT(*) FROM "productAttributes"
    WHERE "organizationId" = $1 ${search ? "AND (name ILIKE $2 OR slug ILIKE $2)" : ""}
  `;
  const countValues = [organizationId, ...(search ? [`%${search}%`] : [])];

  const query = `
    SELECT id, name, slug, "organizationId", "createdAt", "updatedAt",
           (SELECT COUNT(*) FROM "productAttributeTerms" WHERE "attributeId" = pa.id) as term_count
    FROM "productAttributes" pa
    WHERE "organizationId" = $1 ${search ? "AND (name ILIKE $2 OR slug ILIKE $2)" : ""}
    ORDER BY "createdAt" DESC
    LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}
  `;
  const values = [...countValues, pageSize, (page - 1) * pageSize];

  try {
    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const attributes = result.rows.map((row) => ({
      ...row,
      _count: { terms: Number(row.term_count) || 0 },
    }));

    return NextResponse.json({ attributes, totalPages, currentPage: page });
  } catch (error) {
    console.error("[GET /api/product-attributes] error:", error);
    return NextResponse.json({ error: "Failed to fetch attributes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) return NextResponse.json({ error: "Unauthorized: No session" }, { status: 403 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  try {
    const body = await req.json();
    const parsedAttribute = attributeSchema.parse(body);
    const { name, slug } = parsedAttribute;
    const attributeId = uuidv4();

    const slugCheck = await pool.query(
      `SELECT id FROM "productAttributes" WHERE slug = $1 AND "organizationId" = $2`,
      [slug, organizationId]
    );
    if (slugCheck.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    const query = `
    INSERT INTO "productAttributes" (id, name, slug, "organizationId", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING *
    `;
    const result = await pool.query(query, [attributeId, name, slug, organizationId]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("[POST /api/product-attributes] error:", error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
    return NextResponse.json({ error: "Failed to create attribute" }, { status: 500 });
  }
}