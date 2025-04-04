import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
  try {
    const session = await auth.api.getSession({ headers: req.headers });
    console.log("Session data:", session);

    if (!session) {
      console.log("No session, redirecting to /login");
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }

    const user = session.user;
    console.log("User:", user);

    if (user.is_guest) {
      console.log("User is guest, redirecting to /dashboard");
      return NextResponse.json({ redirect: "/dashboard" });
    }

    const { rows: subscriptions } = await pool.query(
      `SELECT * FROM subscription
       WHERE "userId" = $1 AND (status = 'trialing' OR status = 'active')`,
      [user.id]
    );
    console.log("Subscriptions:", subscriptions);

    const now = new Date();
    const hasValidSubscription = subscriptions.some((sub) => {
      const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
      const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
      return (
        (sub.status === "trialing" || sub.status === "active") &&
        (trialEnd ? trialEnd > now : true) &&
        (periodEnd ? periodEnd > now : true)
      );
    });
    console.log("Has valid subscription:", hasValidSubscription);

    if (!hasValidSubscription) {
      console.log("No valid subscription, redirecting to /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    const { rows: tenants } = await pool.query(
      `SELECT "onboardingCompleted" FROM tenant
       WHERE "ownerUserId" = $1`,
      [user.id]
    );
    console.log("Tenants:", tenants);

    const hasTenant = tenants.length > 0;
    if (!hasTenant) {
      console.log("No tenant, redirecting to /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    const onboardingCompleted = tenants[0].onboardingCompleted === -1;
    console.log("Onboarding completed:", onboardingCompleted);

    if (!onboardingCompleted) {
      console.log("Onboarding not completed, redirecting to /onboarding");
      return NextResponse.json({ redirect: "/onboarding" });
    }

    // Check if the session has an active organization
    const hasActiveOrganization = !!session.session.activeOrganizationId;
    console.log("Has active organization:", hasActiveOrganization);

    if (!hasActiveOrganization) {
      console.log("No active organization, redirecting to /select-organization");
      return NextResponse.json({ redirect: "/select-organization" });
    }

    console.log("All checks passed, redirecting to /dashboard");
    return NextResponse.json({ redirect: "/dashboard" });
  } catch (error) {
    console.error("Error in check-status route:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}