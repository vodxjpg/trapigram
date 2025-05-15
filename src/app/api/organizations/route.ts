// src/app/api/organizations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
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