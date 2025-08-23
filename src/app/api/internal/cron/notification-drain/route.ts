// /home/zodx/Desktop/trapigram/src/app/api/internal/cron/notification-drain/route.ts

// src/app/api/internal/cron/notification-drain/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";

/**
 * Invoked by Vercel Cron (GET). Proxies to the internal drain endpoint
 * using x-internal-secret. Also supports manual testing with ?secret=
 * or header x-internal-secret on GET.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const qsSecret = url.searchParams.get("secret") || "";
  const hdrSecret = req.headers.get("x-internal-secret") || "";
  const envSecret = process.env.INTERNAL_API_SECRET || "";

  const ok =
    isCron ||
    (qsSecret && envSecret && qsSecret === envSecret) ||
    (hdrSecret && envSecret && hdrSecret === envSecret);

  // Verbose diagnostics without leaking secret values
  console.log("[cron/notification-drain] GET auth", {
    path: url.pathname,
    isCron,
    hasQsSecret: Boolean(qsSecret),
    hasHdrSecret: Boolean(hdrSecret),
    envSecretLen: envSecret.length,
    qsSecretMatches: Boolean(qsSecret && envSecret && qsSecret === envSecret),
    hdrSecretMatches: Boolean(hdrSecret && envSecret && hdrSecret === envSecret),
  });

  if (!ok) {
    return NextResponse.json(
      { error: "Unauthorized (need x-vercel-cron, ?secret, or x-internal-secret)" },
      { status: 401 },
    );
  }

  const limit = Number(url.searchParams.get("limit") || 12);
  const capped = Math.max(1, Math.min(limit, 50));
  const origin = url.origin;
  const drainUrl = `${origin}/api/internal/notifications/drain?limit=${capped}`;

  try {
    console.log("[cron/notification-drain] POST → drain", { drainUrl, capped });
    const res = await fetch(drainUrl, {
      method: "POST",
      headers: {
        "x-internal-secret": envSecret,
        accept: "application/json",
        // Ask Vercel to run as a background function.
        "x-vercel-background": "1",
      },
    });
    const body = await res.text();
    console.log("[cron/notification-drain] drain ←", {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
      bodyPreview: body.slice(0, 200),
    });
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err: any) {
    console.error("[cron/notification-drain] error", { message: err?.message || String(err) });
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
