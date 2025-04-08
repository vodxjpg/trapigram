// src/app/api/organizations/[slug]/members/route.ts
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
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let userId: string;

    console.log("Request headers:", {
      apiKey: !!apiKey, // Log presence, not value, for security
      internalSecret: !!internalSecret,
    });
    console.log("Requested slug:", slug);

    // Authentication
    if (apiKey) {
      const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
      if (!valid || !key) {
        console.log("API key validation failed:", error?.message);
        return NextResponse.json(
          { error: error?.message || "Invalid API key" },
          { status: 401 }
        );
      }
      userId = key.userId;
      console.log("Authenticated via API key, userId:", userId);
    } else if (internalSecret === INTERNAL_API_SECRET) {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) {
        console.log("Session not found");
        return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
      }
      userId = session.user.id;
      console.log("Authenticated via session, userId:", userId);
    } else {
      console.log("No valid auth method provided");
      return NextResponse.json(
        { error: "Unauthorized: Provide either an API key or internal secret" },
        { status: 403 }
      );
    }

    // Check organization and membership
    const orgQuery = `
      SELECT o.id, o.slug, m."userId", m."organizationId"
      FROM organization o
      JOIN member m ON o.id = m."organizationId"
      WHERE o.slug = $1 AND m."userId" = $2
    `;
    console.log("Executing query:", orgQuery, "with params:", [slug, userId]);
    const { rows: orgRows } = await pool.query(orgQuery, [slug, userId]);
    console.log("Organization query result:", orgRows);

    if (orgRows.length === 0) {
      // Additional check: Does the organization exist at all?
      const { rows: orgCheck } = await pool.query(
        `SELECT id, slug FROM organization WHERE slug = $1`,
        [slug]
      );
      console.log("Organization existence check:", orgCheck);
      if (orgCheck.length === 0) {
        console.log("No organization found with slug:", slug);
      } else {
        console.log("Organization exists, but user is not a member:", userId);
      }
      return NextResponse.json(
        { error: "Organization not found or access denied" },
        { status: 403 }
      );
    }

    const organizationId = orgRows[0].id;
    console.log("Resolved organizationId:", organizationId);

    // Fetch members
    const membersQuery = `
      SELECT m.id, m."userId", m.role, u.name, u.email
      FROM member m
      JOIN "user" u ON m."userId" = u.id
      WHERE m."organizationId" = $1
    `;
    console.log("Fetching members with query:", membersQuery, "param:", [organizationId]);
    const { rows: members } = await pool.query(membersQuery, [organizationId]);
    console.log("Members fetched:", members);

    const formattedMembers = members.map((member) => ({
      id: member.id,
      userId: member.userId,
      role: member.role,
      user: {
        id: member.userId,
        name: member.name,
        email: member.email,
      },
    }));

    return NextResponse.json({ members: formattedMembers }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/organizations/[slug]/members] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}