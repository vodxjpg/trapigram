// src/app/api/organizations/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let userId: string;

    // Case 1: External API request with API key
    if (apiKey) {
      const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (!valid || !key) {
        return NextResponse.json(
          { error: error?.message || "Invalid API key" },
          { status: 401 }
        );
      }
      userId = key.userId;

    // Case 2: Internal UI request with secret
    } else if (internalSecret === INTERNAL_API_SECRET) {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) {
        return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
      }
      userId = session.user.id;

    // No valid auth method
    } else {
      return NextResponse.json(
        { error: "Unauthorized: Provide either an API key or internal secret" },
        { status: 403 }
      );
    }

    // Fetch organization details including member count and user role
    const { rows } = await pool.query(
      `
      SELECT 
        o.id,
        o.name,
        o.slug,
        o.logo,
        o.countries,
        o.metadata,
        o."encryptedSecret",
        m.role AS "userRole",
        COUNT(DISTINCT m2."userId") AS "memberCount"
      FROM organization o
      JOIN member m ON o.id = m."organizationId"
      LEFT JOIN member m2 ON o.id = m2."organizationId"
      WHERE o.slug = $1 AND m."userId" = $2
      GROUP BY o.id, o.name, o.slug, o.logo, o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [slug, userId]
    );

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 404 }
      );
    }

    const organization = {
      id: rows[0].id,
      name: rows[0].name,
      slug: rows[0].slug,
      logo: rows[0].logo || null,
      countries: rows[0].countries,
      metadata: rows[0].metadata,
      encryptedSecret: rows[0].encryptedSecret,
      memberCount: parseInt(rows[0].memberCount, 10),
      userRole: rows[0].userRole,
    };

    return NextResponse.json({ organization }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations/[slug]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}