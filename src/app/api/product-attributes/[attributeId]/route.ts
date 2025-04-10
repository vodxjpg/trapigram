import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const attributeSchema = z.object({
  name: z.string().min(1, "Name is required"),
  slug: z.string().min(1, "Slug is required"),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ attributeId: string }> }
) {
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
    const { attributeId } = await params;

    const query = `
      DELETE FROM "productAttributes"
      WHERE id = $1 AND "organizationId" = $2
      RETURNING *
    `;
    const result = await pool.query(query, [attributeId, organizationId]);

    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Attribute not found" }, { status: 404 });
    }

    return NextResponse.json({ message: "Attribute deleted successfully" });
  } catch (error) {
    console.error("[DELETE /api/product-attributes/[attributeId]] error:", error);
    return NextResponse.json({ error: "Failed to delete attribute" }, { status: 500 });
  }
}