// /home/zodx/Desktop/trapigram/src/app/api/internal/organizations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Query to get all organizations the user is a member of, including member count and role
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
      LEFT JOIN member m2 ON o.id = m2."organizationId" -- Join again to count all members
      WHERE m."userId" = $1
      GROUP BY o.id, o.name, o.slug, o.logo, o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [session.user.id]
    );

    if (rows.length === 0) {
      return NextResponse.json({ organizations: [] }, { status: 200 });
    }

    const organizations = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo || null,
      countries: row.countries,
      metadata: row.metadata,
      encryptedSecret: row.encryptedSecret,
      memberCount: parseInt(row.memberCount, 10), // Convert to number
      userRole: row.userRole,
    }));

    return NextResponse.json({ organizations }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/internal/organizations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}