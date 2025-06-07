// src/app/api/organizations/[identifier]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(req: NextRequest, { params }: { params: Promise<{ identifier: string }> }) {
  const { identifier } = await params;
  if (!identifier) {
    return NextResponse.json({ error: "identifier is required" }, { status: 400 });
  }

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;
  const isService = userId === "service-account";

  const baseSql = `
    SELECT
      o.id,
      o.name,
      o.slug,
      o.logo,
      o.countries,
      o.metadata,
      o."encryptedSecret",
      COUNT(m2."userId")         AS "memberCount",
      MAX(m.role) FILTER (WHERE m."userId" = $2) AS "userRole"
    FROM organization o
    LEFT JOIN member m
      ON m."organizationId" = o.id
    LEFT JOIN member m2
      ON m2."organizationId" = o.id
    WHERE (o.id = $1 OR o.slug = $1)
    /**MEMBERSHIP**/
    GROUP BY
      o.id, o.name, o.slug, o.logo,
      o.countries, o.metadata, o."encryptedSecret"
  `;

  const sql = isService
    ? baseSql.replace('/**MEMBERSHIP**/', '')
    : baseSql.replace(
        '/**MEMBERSHIP**/',
        `AND EXISTS (
           SELECT 1 FROM member 
           WHERE "organizationId" = o.id 
             AND "userId"       = $2
         )`
      );

  try {
    const { rows } = await pool.query(sql, [identifier, userId]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "Organization not found or access denied" }, { status: 404 });
    }

    const r = rows[0];
    return NextResponse.json({
      organization: {
        id: r.id,
        name: r.name,
        slug: r.slug,
        logo: r.logo,
        countries: r.countries,
        metadata: r.metadata,
        encryptedSecret: r.encryptedSecret,
        memberCount: Number(r.memberCount),
        userRole: isService ? null : r.userRole,
      }
    });
  } catch (err) {
    console.error("[GET /api/organizations/:identifier] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { identifier: string } }) {
  const id = params.identifier;
  try {
    await pool.query("BEGIN");
    await pool.query(`DELETE FROM member WHERE "organizationId" = $1`, [id]);
    await pool.query(`DELETE FROM organizationPlatformKey WHERE "organizationId" = $1`, [id]);
    await pool.query(`DELETE FROM organization WHERE id = $1`, [id]);
    await pool.query("COMMIT");
    return NextResponse.json({ id });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("[DELETE /api/organizations/:id]", err);
    return NextResponse.json({ error: "Failed to delete org" }, { status: 500 });
  }
}
