/*───────────────────────────────────────────────────────────────────
  src/app/api/auth/check-status/route.ts     — FULL REPLACEMENT
───────────────────────────────────────────────────────────────────*/

import { NextRequest, NextResponse } from "next/server";
import { auth }                      from "@/lib/auth";
import { pgPool as pool }            from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    /* 0️⃣  Where was the user heading originally? */
    const searchParams = new URL(req.url).searchParams;
    const originalPath = searchParams.get("originalPath") || "";
    console.log("check-status → originalPath:", originalPath);

    /* 1️⃣  Validate the cookie against the DB.
           If the token row was deleted (single-session logic), we get null. */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      console.log("check-status → token revoked → redirect /login");
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }
    console.log("check-status → session OK for user", session.user.id);

    const user = session.user as {
      id: string;
      email: string;
      is_guest?: boolean;
    };

    /* 2️⃣  Guest / password logic (unchanged) */
    const isGuest = user.is_guest ?? false;

    const { rows: credRows } = await pool.query(
      `SELECT 1 FROM account
       WHERE "userId" = $1 AND "providerId" = 'credential' LIMIT 1`,
      [user.id],
    );
    const hasPassword = credRows.length > 0;

    if (isGuest && !hasPassword && !originalPath.startsWith("/accept-invitation/")) {
      console.log("Guest without password → /set-password");
      return NextResponse.json({ redirect: "/set-password" });
    }

    /* 3️⃣  Subscription / tenant / onboarding checks (unchanged) */
    const { rows: subscriptions } = await pool.query(
      `SELECT * FROM subscription
       WHERE "userId" = $1
         AND (status = 'trialing' OR status = 'active')`,
      [user.id],
    );
    const now = new Date();
    const hasValidSub = subscriptions.some((sub) => {
      const trialEnd  = sub.trialEnd  ? new Date(sub.trialEnd)  : null;
      const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
      return (
        (sub.status === "trialing" || sub.status === "active") &&
        (!trialEnd  || trialEnd  > now) &&
        (!periodEnd || periodEnd > now)
      );
    });
    if (!hasValidSub && !isGuest) {
      console.log("No valid subscription → /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    const { rows: tenants } = await pool.query(
      `SELECT "onboardingCompleted" FROM tenant WHERE "ownerUserId" = $1`,
      [user.id],
    );
    if (!tenants.length && !isGuest) {
      console.log("No tenant → /subscribe");
      return NextResponse.json({ redirect: "/subscribe" });
    }

    if (!isGuest) {
      const onboardingDone = tenants[0]?.onboardingCompleted === -1;
      if (!onboardingDone) {
        console.log("Onboarding incomplete → /onboarding");
        return NextResponse.json({ redirect: "/onboarding" });
      }
    }

    /* 4️⃣  Active organisation present? */
    if (!session.session.activeOrganizationId) {
      return NextResponse.json({ redirect: "/select-organization" });
    }

    /* 5️⃣  All checks passed → allow navigation */
    return NextResponse.json({ redirect: null });
  } catch (err) {
    console.error("check-status error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
