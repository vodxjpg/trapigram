import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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
    const { searchParams } = new URL(req.url);
    const slug = searchParams.get("slug");
    const termId = searchParams.get("termId"); // Optional, for editing existing terms

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }
    const query = `
      SELECT id FROM "productAttributeTerms"
      WHERE slug = $1 AND "attributeId" = $2 AND "organizationId" = $3
      ${termId ? "AND id != $4" : ""}
    `;
    const values = termId
      ? [slug, attributeId, organizationId, termId]
      : [slug, attributeId, organizationId];

    const result = await pool.query(query, values);
    const exists = result.rows.length > 0;

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("[GET /api/product-attributes/[attributeId]/terms/check-slug] error:", error);
    return NextResponse.json({ error: "Failed to check slug" }, { status: 500 });
  }
}