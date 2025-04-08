// src/app/api/organizations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
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

    // No valid auth method provided
    } else {
      return NextResponse.json(
        { error: "Unauthorized: Provide either an API key or internal secret" },
        { status: 403 }
      );
    }

    // Fetch organizations for the authenticated user
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
      WHERE m."userId" = $1
      GROUP BY o.id, o.name, o.slug, o.logo, o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [userId]
    );

    // Format response
    const organizations = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo || null,
      countries: row.countries,
      metadata: row.metadata,
      encryptedSecret: row.encryptedSecret,
      memberCount: parseInt(row.memberCount, 10),
      userRole: row.userRole,
    }));

    return NextResponse.json({ organizations }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}