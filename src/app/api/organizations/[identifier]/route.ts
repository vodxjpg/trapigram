// src/app/api/organizations/[identifier]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/**
 * GET /api/organizations/:identifier
 * – identifier may be the organisation id **or** slug
 * – service account (userId === "service-account") → global read
 * – normal user  → must be a member of the organisation
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { identifier: string } },
) {
  const ident = params.identifier;
  if (!ident) {
    return NextResponse.json({ error: "identifier is required" }, { status: 400 });
  }

  /* universal context (handles service-account too) */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { userId } = ctx;
  const isService = userId === "service-account";

  /* ---------------- build SQL dynamically ---------------- */
  const baseSql = `
    SELECT
      o.id,
      o.name,
      o.slug,
      o.logo,
      o.countries,
      o.metadata,
      o."encryptedSecret",
      COUNT(DISTINCT m2."userId")         AS "memberCount",
      MAX(m.role) FILTER (WHERE m."userId" = $2) AS "userRole"
    FROM organization o
    LEFT JOIN member m  ON o.id = m."organizationId"
    LEFT JOIN member m2 ON o.id = m2."organizationId"
    WHERE (o.id = $1 OR o.slug = $1)
    /* membership filter */
    GROUP BY
      o.id, o.name, o.slug, o.logo,
      o.countries, o.metadata, o."encryptedSecret"
  `;

  const sql = isService
    ? baseSql.replace("/* membership filter */", "")
    : baseSql.replace(
        "/* membership filter */",
        'AND EXISTS (SELECT 1 FROM member WHERE "organizationId" = o.id AND "userId" = $2)',
      );

  try {
    const { rows } = await pool.query(sql, [ident, userId]);

    if (!rows.length) {
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 404 },
      );
    }

    const row = rows[0];
    return NextResponse.json(
      {
        organization: {
          id: row.id,
          name: row.name,
          slug: row.slug,
          logo: row.logo || null,
          countries: row.countries,
          metadata: row.metadata,
          encryptedSecret: row.encryptedsecret,
          memberCount: parseInt(row.membercount, 10),
          userRole: isService ? null : row.userrole,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    console.error("[GET /api/organizations/:identifier]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
