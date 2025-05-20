// /src/app/api/organizations/[identifier]/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  req: NextRequest, { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  console.log("Invitations GET request for org slug:", slug);
  
  const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { userId } = ctx;

    try {  

    // Verify that the requesting user is a member of the organization.
    const orgQuery = `
      SELECT o.id, o.slug, m."userId", m."organizationId"
      FROM organization o
      JOIN member m ON o.id = m."organizationId"
      WHERE o.slug = $1 AND m."userId" = $2
    `;
    console.log("Executing organization query with params:", [slug, userId]);
    const { rows: orgRows } = await pool.query(orgQuery, [slug, userId]);
    console.log("Organization query result:", orgRows);

    if (orgRows.length === 0) {
      const { rows: orgCheck } = await pool.query(
        `SELECT id, slug FROM organization WHERE slug = $1`,
        [slug]
      );
      if (orgCheck.length === 0) {
        console.error("No organization found with slug:", slug);
      } else {
        console.error("Organization exists, but user is not a member; userId:", userId);
      }
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 403 }
      );
    }

    const organizationId = orgRows[0].id;
    console.log("Resolved organizationId:", organizationId);

    // Query for pending invitations.
    // Use column names in lowercase if your DB did not preserve camelCase.
    const invitationsQuery = `
      SELECT id, email, role, status, "expiresAt"
      FROM invitation
      WHERE "organizationId" = $1 AND status = 'pending'
      ORDER BY "expiresAt" ASC
    `;
    console.log("Executing invitations query with param:", [organizationId]);
    const { rows: invitations } = await pool.query(invitationsQuery, [organizationId]);
    console.log("Pending invitations fetched:", invitations);

    return NextResponse.json({ invitations }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations/[identifier]/invitations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
