import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  // Authentication
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

  const { attributeId } = await params;
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const termId = searchParams.get("termId"); // Optional, for editing existing terms

  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }

  try {
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