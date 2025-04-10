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

  // Authentication logic
  if (apiKey) {
    const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    const session = await auth.api.getSession({ headers: req.headers });
    organizationId = session?.session.activeOrganizationId || "";
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  } else if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (internal):", session);
    if (!session) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  } else {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session (fallback):", session);
    if (!session) return NextResponse.json({ error: "Unauthorized: No session" }, { status: 403 });
    organizationId = session.session.activeOrganizationId;
    if (!organizationId) return NextResponse.json({ error: "No active organization" }, { status: 400 });
  }

  // Extract query parameters
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug");
  const attributeId = searchParams.get("attributeId"); // Optional, for editing existing attributes

  if (!slug) {
    return NextResponse.json({ error: "Slug is required" }, { status: 400 });
  }

  try {
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