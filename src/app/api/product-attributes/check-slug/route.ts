import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
  // Extract query parameters
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const attributeId = searchParams.get("attributeId"); // Optional, for editing existing attributes

  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }  
    // Check if the slug exists, excluding the current attribute if attributeId is provided
    const query = `
      SELECT id FROM "productAttributes"
      WHERE slug = $1 AND "organizationId" = $2
      ${attributeId ? "AND id != $3" : ""}
    `;
    const values = attributeId ? [slug, organizationId, attributeId] : [slug, organizationId];

    const result = await pool.query(query, values);
    const exists = result.rows.length > 0;

    return NextResponse.json({ exists });
  } catch (error) {
    console.error("[GET /api/product-attributes/check-slug] error:", error);
    return NextResponse.json({ error: "Failed to check slug" }, { status: 500 });
  }
}