// src/app/api/organizations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";

export async function GET(req: NextRequest) {
  const isService = req.headers.get("x-api-key") === SERVICE_API_KEY;

  // 1) Service account: return ALL orgs
  if (isService) {
    try {
      const { rows } = await pool.query(`
        SELECT
          o.id, o.name, o.slug, o.logo,
          o.countries, o.metadata, o."encryptedSecret",
          COUNT(m."userId") AS "memberCount"
        FROM organization o
        LEFT JOIN member m ON m."organizationId" = o.id
        GROUP BY
          o.id, o.name, o.slug, o.logo,
          o.countries, o.metadata, o."encryptedSecret"
      `);

      const organizations = rows.map(r => ({
        id: r.id,
        name: r.name,
        slug: r.slug,
        logo: r.logo,
        countries: r.countries,
        metadata: r.metadata,
        encryptedSecret: r.encryptedSecret,
        memberCount: Number(r.memberCount),
        userRole: null,
      }));

      return NextResponse.json({ organizations });
    } catch (err) {
      console.error("[SERVICE GET /api/organizations]", err);
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  }

  // 2) Normal user: only orgs where they’re a member
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;

  try {
    const { rows } = await pool.query(
      `
      SELECT
        o.id, o.name, o.slug, o.logo,
        o.countries, o.metadata, o."encryptedSecret",
        m.role               AS "userRole",
        COUNT(m2."userId")   AS "memberCount"
      FROM organization o
      JOIN member m
        ON m."organizationId" = o.id
      LEFT JOIN member m2
        ON m2."organizationId" = o.id
      WHERE m."userId" = $1
      AND m.role      = 'owner'
      GROUP BY
        o.id, o.name, o.slug, o.logo,
        o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [userId]
    );

    const organizations = rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      logo: r.logo,
      countries: r.countries,
      metadata: r.metadata,
      encryptedSecret: r.encryptedSecret,
      memberCount: Number(r.memberCount),
      userRole: r.userRole,
    }));

    return NextResponse.json({ organizations });
  } catch (err) {
    console.error("[GET /api/organizations] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
