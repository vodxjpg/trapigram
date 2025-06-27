// src/app/api/internal/onboarding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyInternalPost } from "@/lib/verifyOrigin";
import { pgPool as pool } from "@/lib/db";;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function POST(req: NextRequest) {
  try {
    // 0) CSRF-style origin check — no secret needed
    if (!verifyInternalPost(req)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // 1) Logged-in user
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = session.user;
    const { onboardingCompleted } = await req.json();

    // 2) Validate step (-1 completed, 0–5 in-progress)
    if (
      typeof onboardingCompleted !== "number" ||
      (onboardingCompleted !== -1 && (onboardingCompleted < 0 || onboardingCompleted > 5))
    ) {
      return NextResponse.json({ error: "Invalid onboarding step" }, { status: 400 });
    }

    // 3) Ensure tenant exists and update
    const { rows: tenants } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [user.id],
    );
    if (!tenants.length) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    await pool.query(
      `UPDATE tenant
         SET "onboardingCompleted" = $1,
             "updatedAt"          = NOW()
       WHERE "ownerUserId" = $2`,
      [onboardingCompleted, user.id],
    );

    return NextResponse.json({ message: "Onboarding step updated" }, { status: 200 });
  } catch (error) {
    console.error("Error in onboarding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
