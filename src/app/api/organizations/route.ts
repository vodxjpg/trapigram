import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
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

    // Query to fetch organizations the user is a member of
    const { rows: organizations } = await pool.query(
      `SELECT o.* FROM organization o
       JOIN member m ON o.id = m."organizationId"
       WHERE m."userId" = $1`,
      [userId]
    );

    // Return the list of organizations
    return NextResponse.json({ organizations }, { status: 200 });
  } catch (error) {
    console.error("Error in /api/organizations:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}