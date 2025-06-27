import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const termSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string; termId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { attributeId, termId } = await params;
    const body = await req.json();
    const parsedTerm = termSchema.parse(body);
    const { name, slug } = parsedTerm;

    // Check if the slug is taken by another term within the same attribute
    const slugCheck = await pool.query(
      `SELECT id FROM "productAttributeTerms" WHERE slug = $1 AND "attributeId" = $2 AND id != $3 AND "organizationId" = $4`,
      [slug, attributeId, termId, organizationId]
    );
    if (slugCheck.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists for this attribute" }, { status: 400 });
    }

    // Update the term
    const query = `
      UPDATE "productAttributeTerms"
      SET name = $1, slug = $2, "updatedAt" = NOW()
      WHERE id = $3 AND "attributeId" = $4 AND "organizationId" = $5
      RETURNING *
    `;
    const result = await pool.query(query, [name, slug, termId, attributeId, organizationId]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Term not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("[PATCH /api/product-attributes/[attributeId]/terms/[termId]] error:", error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
    return NextResponse.json({ error: "Failed to update term" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string; termId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { attributeId, termId } = await params;

    const query = `
      DELETE FROM "productAttributeTerms"
      WHERE id = $1 AND "attributeId" = $2 AND "organizationId" = $3
      RETURNING *
    `;
    const result = await pool.query(query, [termId, attributeId, organizationId]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Term not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Term deleted successfully" });
  } catch (error) {
    console.error("[DELETE /api/product-attributes/[attributeId]/terms/[termId]] error:", error);
    return NextResponse.json({ error: "Failed to delete term" }, { status: 500 });
  }
}