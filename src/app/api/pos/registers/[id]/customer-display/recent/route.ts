// /app/api/pos/registers/[id]/customer-display/recent/route.ts
import { NextRequest, NextResponse } from "next/server";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const limit = Math.min(50, Math.max(1, Number(searchParams.get("limit") ?? 10)));

  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ events: [] }, { status: 200 });
  }

  const key = `cd:recent:${id}`;
  const start = 0;
  const stop = limit - 1;

  const res = await fetch(`${REDIS_URL}/lrange/${key}/${start}/${stop}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
    cache: "no-store",
  });

  if (!res.ok) return NextResponse.json({ events: [] }, { status: 200 });

  const arr = (await res.json())?.result ?? [];
  const events = arr
    .map((s: string) => {
      try { return JSON.parse(s); } catch { return null; }
    })
    .filter(Boolean);

  return NextResponse.json({ events }, { status: 200 });
}
