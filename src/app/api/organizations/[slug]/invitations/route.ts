// /src/app/api/organizations/[slug]/invitations/route.ts
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
    console.log("Invitations GET request for org slug:", slug);

    // Retrieve authentication credentials from headers.
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let userId: string;

    if (apiKey) {
      const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (!valid || !key) {
        console.error("API key validation failed:", error?.message);
        return NextResponse.json(
          { error: error?.message || "Invalid API key" },
          { status: 401 }
        );
      }
      userId = key.userId;
      console.log("Authenticated via API key; userId:", userId);
    } else if (internalSecret === INTERNAL_API_SECRET) {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) {
        console.error("Session not found for internal secret");
        return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
      }
      userId = session.user.id;
      console.log("Authenticated via internal secret; userId:", userId);
    } else {
      console.error("No valid authentication method provided");
      return NextResponse.json(
        { error: "Unauthorized: Provide either an API key or internal secret" },
        { status: 403 }
      );
    }

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
    console.error("[GET /api/organizations/[slug]/invitations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
