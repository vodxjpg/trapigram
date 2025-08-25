// Runs on Vercel Cron
export const runtime = "nodejs";
export const preferredRegion = ["iad1"]; // pick the region near your DB
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";

const INTERNAL = process.env.INTERNAL_API_SECRET!;
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export async function GET(req: NextRequest) {
  if (!INTERNAL) {
    return NextResponse.json({ error: "INTERNAL_API_SECRET not set" }, { status: 500 });
  }
  if (!APP_URL) {
    return NextResponse.json({ error: "APP URL not resolved" }, { status: 500 });
  }

  const dry =
    req.nextUrl.searchParams.get("dry") === "1" ||
    req.nextUrl.searchParams.get("dryRun") === "true";

  // find stale "open/underpaid" older than 12h
  const cutoffIso = new Date(Date.now() - 12 * 3600 * 1000).toISOString();

  const { rows } = await pool.query(
    `SELECT id
       FROM orders
      WHERE status IN ('open','underpaid')
        AND "dateCreated" < $1
      ORDER BY "dateCreated" ASC
      LIMIT 200`,
    [cutoffIso],
  );

  const ids: string[] = rows.map((r) => r.id);
  const results: Array<{ id: string; ok: boolean; status?: number }> = [];

  if (!ids.length) {
    return NextResponse.json({ tried: 0, ok: 0, fail: 0, results: [] });
  }

  await Promise.all(
    ids.map(async (id) => {
      if (dry) {
        results.push({ id, ok: true, status: 0 });
        return;
      }
      try {
        const res = await fetch(`${APP_URL}/api/order/${id}/change-status`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-internal-secret": INTERNAL,
          },
          body: JSON.stringify({ status: "cancelled" }),
        });
        results.push({ id, ok: res.ok, status: res.status });
      } catch {
        results.push({ id, ok: false });
      }
    }),
  );

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  return NextResponse.json({ tried: results.length, ok, fail, results });
}
