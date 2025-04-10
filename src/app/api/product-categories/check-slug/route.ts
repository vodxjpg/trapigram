import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  console.log("Headers received:", Object.fromEntries(req.headers.entries()));
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const categoryId = searchParams.get("categoryId");
  const explicitOrgId = searchParams.get("organizationId");

  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }

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

  try {
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