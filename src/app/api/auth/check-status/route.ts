/*───────────────────────────────────────────────────────────────────
  src/app/api/auth/check-status/route.ts       — UPDATED OVERDUE LOGIC
───────────────────────────────────────────────────────────────────*/

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { pgPool } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    /* where was the user heading? */
    const searchParams = new URL(req.url).searchParams;
    const originalPath = searchParams.get("originalPath") || "";

    /* 1️⃣ validate cookie & pull session */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session) {
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }

    const currentSessionId = session.session.id as string;
    const userId = session.user.id as string;

    /* 2️⃣ single-session check */
    const { rows: [latest] } = await pgPool.query<{ id: string }>(
      `SELECT id
         FROM session
        WHERE "userId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 1`,
      [userId],
    );
    if (!latest || latest.id !== currentSessionId) {
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }

    /* —— unchanged business logic up to onboarding —— */
    const isGuest = (session.user as any).is_guest ?? false;
    const { rows: credRows } = await pgPool.query(
      `SELECT 1 FROM account
       WHERE "userId" = $1 AND "providerId" = 'credential'
       LIMIT 1`,
      [userId],
    );
    const hasPassword = credRows.length > 0;

    if (isGuest &&
        !hasPassword &&
        !originalPath.startsWith("/accept-invitation/")) {
      return NextResponse.json({ redirect: "/set-password" });
    }

    const { rows: subscriptions } = await pgPool.query(
      `SELECT * FROM subscription
       WHERE "userId" = $1
         AND (status = 'trialing' OR status = 'active')`,
      [userId],
    );
    const now = new Date();
    const hasValidSub = subscriptions.some((sub) => {
      const trialEnd = sub.trialEnd ? new Date(sub.trialEnd) : null;
      const periodEnd = sub.periodEnd ? new Date(sub.periodEnd) : null;
      return (
        (sub.status === "trialing" || sub.status === "active") &&
        (!trialEnd || trialEnd > now) &&
        (!periodEnd || periodEnd > now)
      );
    });
    if (!hasValidSub && !isGuest) {
      return NextResponse.json({ redirect: "/subscribe" });
    }

    const { rows: tenants } = await pgPool.query(
      `SELECT "onboardingCompleted"
         FROM tenant
        WHERE "ownerUserId" = $1`,
      [userId],
    );
    if (!tenants.length && !isGuest) {
      return NextResponse.json({ redirect: "/subscribe" });
    }
    if (!isGuest) {
      const onboardingDone = tenants[0]?.onboardingCompleted === -1;
      if (!onboardingDone) {
        return NextResponse.json({ redirect: "/onboarding" });
      }
    }

    if (!session.session.activeOrganizationId) {
      return NextResponse.json({ redirect: "/select-organization" });
    }

    /* ── NEW: Overdue-invoice check ─────────────────────────────
       If they have any unpaid invoice past due, redirect them
       to /billing — but *only* if they’re NOT already on any
       /billing… page (list or detail). */
    const today = new Date().toISOString().slice(0, 10);
    const { rows: overdueRows } = await pgPool.query(
      `SELECT id
         FROM "userInvoices"
        WHERE "userId" = $1
          AND status != 'paid'
          AND "dueDate" < $2
        LIMIT 1`,
      [userId, today],
    );

    const isBillingPath = originalPath === "/billing"
      || originalPath.startsWith("/billing/");

    if (overdueRows.length > 0 && !isBillingPath) {
      return NextResponse.json({ redirect: "/billing" });
    }
    /* ──────────────────────────────────────────────────────────── */

    /* all good → allow navigation */
    return NextResponse.json({ redirect: null });
  } catch (err) {
    console.error("check-status route error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
