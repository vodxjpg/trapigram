// src/app/api/organizations/[slug]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  req: NextRequest, { params }: { params: Promise<{ slug: string }> }
) {
const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;
  const { slug } = await params;

  try {    
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