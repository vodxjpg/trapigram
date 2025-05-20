// src/app/api/organizations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const SERVICE_API_KEY = process.env.SERVICE_API_KEY ?? "";

export async function GET(req: NextRequest) {
  /* 1 — check for the service API-key */
  const isService = req.headers.get("x-api-key") === SERVICE_API_KEY;

  /* 2 — Service account ⇒ return **all** organisations */
  if (isService) {
    try {
      const { rows } = await pool.query(`
        SELECT
          o.id,
          o.name,
          o.slug,
          o.logo,
          o.countries,
          o.metadata,
          o."encryptedSecret",
          COUNT(DISTINCT m."userId") AS "memberCount"
        FROM organization o
        LEFT JOIN member m ON o.id = m."organizationId"
        GROUP BY
          o.id, o.name, o.slug, o.logo,
          o.countries, o.metadata, o."encryptedSecret"
      `);

      const organizations = rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        logo: row.logo || null,
        countries: row.countries,
        metadata: row.metadata,
        encryptedSecret: row.encryptedSecret,
        memberCount: parseInt(row.membercount, 10),
        userRole: null,                          // service account isn’t a member
      }));

      return NextResponse.json({ organizations }, { status: 200 });
    } catch (error) {
      /* eslint-disable no-console */
      console.error("[SERVICE GET /api/organizations]", error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  /* 3 — Normal user flow (unchanged) */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
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
        m.role           AS "userRole",
        COUNT(DISTINCT m2."userId") AS "memberCount"
      FROM organization o
      JOIN   member m  ON o.id = m."organizationId"
      LEFT   JOIN member m2 ON o.id = m2."organizationId"
      WHERE  m."userId" = $1
      GROUP  BY
        o.id, o.name, o.slug, o.logo,
        o.countries, o.metadata, o."encryptedSecret", m.role
      `,
      [userId],
    );

    const organizations = rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      logo: row.logo || null,
      countries: row.countries,
      metadata: row.metadata,
      encryptedSecret: row.encryptedSecret,
      memberCount: parseInt(row.membercount, 10),
      userRole: row.userrole,
    }));

    return NextResponse.json({ organizations }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
