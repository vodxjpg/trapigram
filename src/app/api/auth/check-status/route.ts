import { NextRequest, NextResponse } from "next/server";
import { auth }      from "@/lib/auth";
import { pgPool }    from "@/lib/db";

/* 3 s statement timeout for every query issued via pgPool */
async function withTimeout<T>(fn: (c: any)=>Promise<T>): Promise<T> {
  const client = await pgPool.connect();
  try {
    await client.query('SET LOCAL statement_timeout = 3000');
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function GET(req: NextRequest) {
  try {
    /*──────────────────── 0. input & session ───────────────────*/
    const originalPath = new URL(req.url).searchParams.get("originalPath") ?? "";
    const session = await auth.api.getSession({ headers: req.headers });

    if (!session) {
      return NextResponse.json({ redirect: "/login" }, { status: 401 });
    }
    const userId   = session.user.id;
    const isGuest  = (session.user as any)?.is_guest ?? false;

    /*──────────────────── 1. bulk DB look-ups (one shot) ───────*/
    const row = await withTimeout(async (db) => {
      const { rows } = await db.query(`
        WITH sub AS (
          SELECT 1 AS ok
          FROM   subscription
          WHERE  "userId" = $1
          AND    status IN ('trialing','active')
          AND    COALESCE(trialEnd, periodEnd, NOW() + INTERVAL '1 second') > NOW()
          LIMIT  1
        ),
        pass AS (
          SELECT 1 AS ok
          FROM   account
          WHERE  "userId"   = $1
          AND    "providerId" = 'credential'
          LIMIT  1
        ),
        tenant AS (
          SELECT "onboardingCompleted" AS onboarding
          FROM   tenant
          WHERE  "ownerUserId" = $1
          LIMIT  1
        )
        SELECT
          EXISTS (SELECT 1 FROM sub)   AS has_subscription,
          EXISTS (SELECT 1 FROM pass)  AS has_password,
          (SELECT onboarding FROM tenant)   AS onboarding,
          $2::bool                       AS is_guest
      `, [userId, isGuest]);
      return rows[0];
    });

    /*──────────────────── 2. policy tree ───────────────────────*/
    if (row.is_guest && !row.has_password) {
      if (!originalPath.startsWith("/accept-invitation/")) {
        return NextResponse.json({ redirect: "/set-password" });
      }
    }

    if (!row.has_subscription && !row.is_guest) {
      return NextResponse.json({ redirect: "/subscribe" });
    }

    if (row.onboarding !== -1 && !row.is_guest) {
      return NextResponse.json({ redirect: "/onboarding" });
    }

    if (!session.session.activeOrganizationId) {
      return NextResponse.json({ redirect: "/select-organization" });
    }

    return NextResponse.json({ redirect: null });       // ✅ all good
  } catch (err) {
    console.error("[check-status] transient failure:", err);
    /* don’t bounce the user to /login on a server hiccup */
    return NextResponse.json(
      { retry: true },
      { status: 503 },
    );
  }
}
