import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> } // Explicitly type params as a Promise
) {
  try {
    // Await params to resolve the slug
    const { slug } = await context.params;

    // Extract API key from headers
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      return NextResponse.json({ error: "API key is required" }, { status: 401 });
    }

    // Validate API key using Better Auth
    const { valid, error, key } = await auth.api.verifyApiKey({
      body: { key: apiKey },
    });

    if (!valid || !key) {
      return NextResponse.json(
        { error: error?.message || "Invalid API key" },
        { status: 401 }
      );
    }

    const userId = key.userId;

    // Query to fetch organization details if the user is a member
    const { rows: organizations } = await pool.query(
      `SELECT o.* FROM organization o
       JOIN member m ON o.id = m."organizationId"
       WHERE o.slug = $1 AND m."userId" = $2`,
      [slug, userId]
    );

    if (organizations.length === 0) {
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 404 }
      );
    }

    // Return the organization details
    return NextResponse.json({ organization: organizations[0] }, { status: 200 });
  } catch (error) {
    console.error("Error in /api/organizations/[slug]:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}