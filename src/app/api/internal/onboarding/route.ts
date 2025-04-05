// /home/zodx/Desktop/trapigram/src/app/api/internal/onboarding/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

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
    const { onboardingCompleted } = await req.json();

    // Allow -1 (completed), 0 (not started), or 1-5 (steps)
    if (
      typeof onboardingCompleted !== "number" ||
      (onboardingCompleted !== -1 && (onboardingCompleted < 0 || onboardingCompleted > 5))
    ) {
      return NextResponse.json({ error: "Invalid onboarding step" }, { status: 400 });
    }

    const { rows: tenants } = await pool.query(
      `SELECT id FROM tenant WHERE "ownerUserId" = $1`,
      [user.id]
    );
    if (tenants.length === 0) {
      return NextResponse.json({ error: "No tenant found" }, { status: 404 });
    }

    await pool.query(
      `UPDATE tenant SET "onboardingCompleted" = $1, "updatedAt" = NOW() WHERE "ownerUserId" = $2`,
      [onboardingCompleted, user.id]
    );

    console.log(onboardingCompleted === -1)

    if (onboardingCompleted === -1) {
      const apiKey = await auth.api.createApiKey({
        body: {
          name: "My API Key",
          expiresIn: 60 * 60 * 24 * 365, // 1 year
          prefix: "my_app",
          remaining: 100,
          refillAmount: 100,
          refillInterval: 60 * 60 * 24 * 7, // 7 days
          metadata: {
            tier: "premium",
          },
          rateLimitTimeWindow: 1000 * 60 * 60 * 24, // everyday
          rateLimitMax: 100, // every day, they can use up to 100 requests
          rateLimitEnabled: true,
          userId: user.id, // the user id to create the API key for
        },
      });

      console.log(apiKey)
    }

    return NextResponse.json({ message: "Onboarding step updated" }, { status: 200 });
  } catch (error) {
    console.error("Error in onboarding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}