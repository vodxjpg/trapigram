// /home/zodx/Desktop/Trapyfy/src/app/api/auth/check-status/route.ts

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pgPool as pool } from "@/lib/db";;

// nothing
export async function GET(req: NextRequest) {
  try {
    // 0) Get the original path from query param, so we know what page the user is *really* requesting
    const searchParams = new URL(req.url).searchParams;
    const originalPath = searchParams.get("originalPath") || "";
    console.log("Check-status => originalPath is:", originalPath);

    // 1) getSession from Better Auth (mostly to confirm user is logged in)
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      console.log("No session => /login");
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }
    console.log("Session data:", session);

    const user = session.user as {
      id: string;
      email: string;
      is_guest?: boolean;
    };

    // 2) Check if user is guest from DB perspective
    const isGuest = user.is_guest ?? false;

    // 3) Check if user has a credential-based password
    const { rows: credRows } = await pool.query(
      `SELECT 1 FROM account
       WHERE "userId" = $1
         AND "providerId" = 'credential'
       LIMIT 1`,
      [user.id]
    );
    const hasPassword = credRows.length > 0;
    console.log(
      `User ${user.id} => is_guest=${isGuest}, hasPassword=${hasPassword}`
    );

    // 4) If user is guest AND no password => default to /set-password
    //    BUT skip if the *original path* is /accept-invitation/...
    if (isGuest && !hasPassword) {
      if (originalPath.startsWith("/accept-invitation/")) {
        console.log(
          "User is guest with no password, but they're on accept-invitation => skipping forced /set-password"
        );
        // We'll let them proceed so the invitation can get accepted
      } else {
        console.log("Guest user, no credential => /set-password");
        return NextResponse.json({ redirect: "/set-password" });
      }
    }

    // 5) Subscription checks as before
    const { rows: subscriptions } = await pool.query(
      `SELECT * FROM subscription
       WHERE "userId" = $1
         AND (status = 'trialing' OR status = 'active')`,
      [user.id]
    );
    const now = new Date();
    const hasValidSubscription = subscriptions.some((sub) => {
      const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
      const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
      return (
        (sub.status === "trialing" || sub.status === "active") &&
        (!trialEnd || trialEnd > now) &&
        (!periodEnd || periodEnd > now)
      );
    });
    if (!hasValidSubscription && !isGuest) {
      console.log("No valid subscription => /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    // 6) Tenant check
    const { rows: tenants } = await pool.query(
      `SELECT "onboardingCompleted" FROM tenant
       WHERE "ownerUserId" = $1`,
      [user.id]
    );
    if (!tenants.length && !isGuest) {
      console.log("No tenant => /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    // 7) Onboarding
    if (!isGuest) {
      const onboardingCompleted = tenants[0]?.onboardingCompleted === -1;
      if (!onboardingCompleted && !isGuest) {
        console.log("Onboarding not completed => /onboarding");
        return NextResponse.json({ redirect: "/onboarding" });
      }
    }

    // 8) Active organization
    const hasActiveOrganization = !!session.session.activeOrganizationId;
    if (!hasActiveOrganization) {
      console.log("No active org => /select-organization");
      return NextResponse.json({ redirect: "/select-organization" });
    }

    // 9) All checks ok => no forced redirect
    console.log("All checks passed => no redirect");
    return NextResponse.json({ redirect: null });
  } catch (error) {
    console.error("Error in check-status route:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
