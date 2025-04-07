// /home/zodx/Desktop/trapigram/src/app/api/internal/organization/[id]/invitations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    // Verify internal API secret
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    // Get authenticated session
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Extract organization ID from params
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: "No organization ID provided" }, { status: 400 });
    }

    // Check if the user is a member of the organization and get their role
    const { rows: membership } = await pool.query(
      `SELECT "role" FROM member WHERE "organizationId" = $1 AND "userId" = $2`,
      [id, session.user.id]
    );
    if (membership.length === 0) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Fetch all pending invitations for the organization
    const { rows: invitations } = await pool.query(
      `SELECT id, email, role, status, "expiresAt"
       FROM invitation
       WHERE "organizationId" = $1 AND status = 'pending'`,
      [id]
    );

    // Format the response to match the expected Invitation type
    const formattedInvitations = invitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      role: inv.role,
      status: inv.status as "pending" | "accepted" | "rejected" | "canceled",
      expiresAt: inv.expiresAt.toISOString(), // Using expiresAt instead of createdAt
    }));

    return NextResponse.json({ invitations: formattedInvitations }, { status: 200 });
  } catch (error) {
    console.error("[GET /api/internal/organization/[id]/invitations] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}