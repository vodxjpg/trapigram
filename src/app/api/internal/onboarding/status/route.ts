// /home/zodx/Desktop/trapigram/src/app/api/internal/onboarding/status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "your-secret-here";

export async function GET(req: NextRequest) {
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

    // Check if user owns an organization
    const { data: organizations } = await authClient.organization.list();
    const ownsOrganization = organizations.some((org: any) => org.role === "owner");

    // Check tenant onboarding status
    const { rows: tenants } = await pool.query(
      `SELECT "onboardingCompleted" FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );

    const tenant = tenants[0];
    const onboardingCompleted = tenant ? tenant.onboardingCompleted : 0;

    // Determine current step
    let currentStep = 0;
    if (ownsOrganization) {
      currentStep = Math.max(onboardingCompleted, 1); // Step 1 complete if org exists
    } else {
      currentStep = onboardingCompleted; // Use tenant status if no org
    }

    return NextResponse.json({ currentStep }, { status: 200 });
  } catch (error) {
    console.error("Error checking onboarding status:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}