import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  try {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("categoryId");
    const slug = searchParams.get("slug");

    const query = categoryId
      ? `SELECT id FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2 AND id != $3`
      : `SELECT id FROM "productCategories" WHERE slug = $1 AND "organizationId" = $2`;
    const values = categoryId ? [slug, organizationId, categoryId] : [slug, organizationId];

    const result = await pool.query(query, values);
    const exists = result.rows.length > 0;

    return NextResponse.json({ exists });
  } catch (error: any) {
    console.error("[GET /api/product-categories/check-slug] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}