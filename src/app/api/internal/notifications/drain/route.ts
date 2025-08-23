// /home/zodx/Desktop/trapigram/src/app/api/internal/notifications/drain/route.ts

// src/app/api/internal/notifications/drain/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { drainNotificationOutbox } from "@/lib/notification-outbox";

/**
 * POST: primary entry used by the cron wrapper and internal nudges.
 * Auth: x-internal-secret header OR ?secret= query param (for manual tests).
 */
export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const hdrSecret = req.headers.get("x-internal-secret") || "";
  const qsSecret = url.searchParams.get("secret") || "";
  const envSecret = process.env.INTERNAL_API_SECRET || "";
  const authorized =
    (hdrSecret && hdrSecret === envSecret) || (qsSecret && qsSecret === envSecret);

  console.log("[internal/notifications/drain] POST auth", {
    hasHdrSecret: Boolean(hdrSecret),
    hasQsSecret: Boolean(qsSecret),
    envSecretLen: envSecret.length,
    hdrMatches: Boolean(hdrSecret && hdrSecret === envSecret),
    qsMatches: Boolean(qsSecret && qsSecret === envSecret),
  });

  if (!authorized) {
    return NextResponse.json(
      { error: "Unauthorized (x-internal-secret header or ?secret required)" },
      { status: 401 },
    );
  }

  const limit = Number(url.searchParams.get("limit") || 12);
  const capped = Math.max(1, Math.min(limit, 50));
  console.log("[internal/notifications/drain] draining…", { capped });

  try {
    const res = await drainNotificationOutbox(capped);
    console.log("[internal/notifications/drain] done", res);
    return NextResponse.json(res);
  } catch (err: any) {
    console.error("[internal/notifications/drain] drain error", {
      message: err?.message || String(err),
    });
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}

/**
 * GET: used by Vercel Cron directly (x-vercel-cron header) or for manual testing with ?secret=.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const qsSecret = url.searchParams.get("secret") || "";
  const envSecret = process.env.INTERNAL_API_SECRET || "";

  const ok = isCron || (qsSecret && qsSecret === envSecret);

  console.log("[internal/notifications/drain] GET auth", {
    isCron,
    hasQsSecret: Boolean(qsSecret),
    envSecretLen: envSecret.length,
    qsMatches: Boolean(qsSecret && qsSecret === envSecret),
  });

  if (!ok) {
    return NextResponse.json(
      { error: "Unauthorized (x-vercel-cron or ?secret required)" },
      { status: 401 },
    );
  }

  const limit = Number(url.searchParams.get("limit") || 12);
  const capped = Math.max(1, Math.min(limit, 50));
  console.log("[internal/notifications/drain] GET draining…", { capped });

  try {
    const res = await drainNotificationOutbox(capped);
    console.log("[internal/notifications/drain] GET done", res);
    return NextResponse.json(res);
  } catch (err: any) {
    console.error("[internal/notifications/drain] GET drain error", {
      message: err?.message || String(err),
    });
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
