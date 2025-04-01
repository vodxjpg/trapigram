// /home/zodx/Desktop/trapigram/src/app/api/internal/onboarding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "your-secret-here";

export async function POST(req: NextRequest) {
  try {
    const secret = req.headers.get("x-internal-secret");
    if (secret !== INTERNAL_API_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user;

    // Check if tenant exists
    const { rows: tenants } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );

    if (tenants.length === 0) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    // Update onboarding status (for now, just mark as complete)
    await pool.query(
      `UPDATE tenant SET "onboardingCompleted = 1, "updatedAt" = NOW()
       WHERE "ownerUserId" = $1`,
      [user.id]
    );

    return NextResponse.json({ message: "Onboarding completed" }, { status: 200 });
  } catch (error) {
    console.error("Error in onboarding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}