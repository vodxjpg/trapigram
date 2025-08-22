// src/app/api/internal/notifications/drain/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { drainNotificationOutbox } from "@/lib/notification-outbox";


export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-internal-secret");
  if (!secret || secret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Number(req.nextUrl.searchParams.get("limit") || 12);
  const res = await drainNotificationOutbox(Math.max(1, Math.min(limit, 50)));
  return NextResponse.json(res);
}


// Vercel Cron hits GET without custom headers.
// Accept GET only when it's a Vercel cron (x-vercel-cron: 1)
// or when ?secret=INTERNAL_API_SECRET is provided (manual trigger).
export async function GET(req: NextRequest) {
  const isCron = req.headers.get("x-vercel-cron") === "1";
  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret");
  if (!isCron && qsSecret !== process.env.INTERNAL_API_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limit = Number(url.searchParams.get("limit") || 12);
  const res = await drainNotificationOutbox(Math.max(1, Math.min(limit, 50)));
  return NextResponse.json(res);
}