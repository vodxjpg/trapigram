// src/app/api/organizations/[identifier]/members/route.ts
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

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { userId } = ctx;

  try {
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
    console.error("[GET /api/organizations/[identifier]/members] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}