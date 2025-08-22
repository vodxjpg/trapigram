
// src/app/api/cron/notifications-drain/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";


/**
 * This route is invoked by Vercel Cron (GET). It securely POSTs to the
 * internal drain endpoint with x-internal-secret.
 */
export async function GET(req: NextRequest) {
  // Only allow Vercel's scheduled invocations (or allow manual via ?secret=)
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  if (!isCron && qsSecret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Optional tweak via ?limit=... during manual tests
  const limit = Number(url.searchParams.get("limit") || 12);
  const origin = url.origin; // current deployment origin

  try {
    const res = await fetch(
      `${origin}/api/internal/notifications/drain?limit=${Math.max(1, Math.min(limit, 50))}`,
      {
        method: "POST",
        headers: {
          "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
          "accept": "application/json"
        }
      }
    );
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" }
    });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 500 });
  }
}
