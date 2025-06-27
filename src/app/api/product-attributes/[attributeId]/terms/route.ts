import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

// nothing
const termSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ attributeId: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search = searchParams.get("search") || "";

    const { attributeId } = await params;

    const countQuery = `
    SELECT COUNT(*) FROM "productAttributeTerms"
    WHERE "attributeId" = $1 AND "organizationId" = $2 ${search ? "AND (name ILIKE $3 OR slug ILIKE $3)" : ""}
  `;
    const countValues = [attributeId, organizationId, ...(search ? [`%${search}%`] : [])];

    const query = `
    SELECT id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt"
    FROM "productAttributeTerms"
    WHERE "attributeId" = $1 AND "organizationId" = $2 ${search ? "AND (name ILIKE $3 OR slug ILIKE $3)" : ""}
    ORDER BY "createdAt" DESC
    LIMIT $${countValues.length + 1} OFFSET $${countValues.length + 2}
  `;
    const values = [...countValues, pageSize, (page - 1) * pageSize];


    const countResult = await pool.query(countQuery, countValues);
    const totalRows = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(totalRows / pageSize);

    const result = await pool.query(query, values);
    const terms = result.rows;

    return NextResponse.json({ terms, totalPages, currentPage: page });
  } catch (error) {
    console.error("[GET /api/product-attributes/[attributeId]/terms] error:", error);
    return NextResponse.json({ error: "Failed to fetch terms" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ attributeId: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { attributeId } = await params;
    const body = await req.json();
    const parsedTerm = termSchema.parse(body);
    const { name, slug } = parsedTerm;
    const termId = uuidv4();

    const slugCheck = await pool.query(
      `SELECT id FROM "productAttributeTerms" WHERE "attributeId" = $1 AND slug = $2 AND "organizationId" = $3`,
      [attributeId, slug, organizationId]
    );
    if (slugCheck.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists for this attribute" }, { status: 400 });
    }

    const query = `
      INSERT INTO "productAttributeTerms" (id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
      VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *
    `;
    const result = await pool.query(query, [termId, attributeId, name, slug, organizationId]);
    return NextResponse.json(result.rows[0], { status: 201 });
  } catch (error) {
    console.error("[POST /api/product-attributes/[attributeId]/terms] error:", error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
    return NextResponse.json({ error: "Failed to create term" }, { status: 500 });
  }
}