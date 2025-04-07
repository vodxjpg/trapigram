// /home/zodx/Desktop/trapigram/src/app/api/internal/organization/[id]/members/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "No organization ID provided" }, { status: 400 });
    }

    const { rows: membership } = await pool.query(
      `SELECT "role" FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
      [id, session.user.id]
    );
    if (membership.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { rows: members } = await pool.query(
      `SELECT m.id, m."userId", m.role, u.name, u.email
       FROM member m
       JOIN "user" u ON m."userId" = u.id
       WHERE m."organizationId" = $1`,
      [id]
    );

    // Transform flat structure to nested structure
    const formattedMembers = members.map(member => ({
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
    console.error("[GET /api/internal/organization/[id]/members] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}