import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
const attributeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { attributeId } = await params;

    const query = `
      SELECT id, name, slug, "organizationId", "createdAt", "updatedAt"
      FROM "productAttributes"
      WHERE id = $1 AND "organizationId" = $2
    `;
    const result = await pool.query(query, [attributeId, organizationId]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Attribute not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("[GET /api/product-attributes/[attributeId]] error:", error);
    return NextResponse.json({ error: "Failed to fetch attribute" }, { status: 500 });
  }
}

// Existing PATCH and DELETE handlers (unchanged)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { attributeId } = await params;
    const body = await req.json();
    const parsedAttribute = attributeSchema.parse(body);
    const { name, slug } = parsedAttribute;

    const slugCheck = await pool.query(
      `SELECT id FROM "productAttributes" WHERE slug = $1 AND "organizationId" = $2 AND id != $3`,
      [slug, organizationId, attributeId]
    );
    if (slugCheck.rows.length > 0) {
      return NextResponse.json({ error: "Slug already exists" }, { status: 400 });
    }

    const query = `
      UPDATE "productAttributes"
      SET name = $1, slug = $2, "updatedAt" = NOW()
      WHERE id = $3 AND "organizationId" = $4
      RETURNING *
    `;
    const result = await pool.query(query, [name, slug, attributeId, organizationId]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Attribute not found" }, { status: 404 });
    }

    return NextResponse.json(result.rows[0]);
  } catch (error) {
    console.error("[PATCH /api/product-attributes/[attributeId]] error:", error);
    if (error instanceof z.ZodError) return NextResponse.json({ error: error.errors }, { status: 400 });
    return NextResponse.json({ error: "Failed to update attribute" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { attributeId } = await params;
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1) delete all terms for this attribute
    await client.query(
      `DELETE FROM "productAttributeTerms"
       WHERE "attributeId" = $1
         AND "organizationId" = $2`,
      [attributeId, organizationId]
    );

    // 2) delete the attribute itself
    const result = await client.query(
      `DELETE FROM "productAttributes"
       WHERE id = $1
         AND "organizationId" = $2
       RETURNING *`,
      [attributeId, organizationId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { error: "Attribute not found" },
        { status: 404 }
      );
    }

    await client.query("COMMIT");
    return NextResponse.json(
      { message: "Attribute and its terms deleted successfully" }
    );
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(
      "[DELETE /api/product-attributes/[attributeId]] error:",
      error
    );
    return NextResponse.json(
      { error: "Failed to delete attribute" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
