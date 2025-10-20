// /app/api/pos/registers/[id]/customer-display/recent/route.ts
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Parse ?limit= (1..50)
  const { searchParams } = new URL(req.url);
  const limitRaw = Number(searchParams.get("limit") ?? 10);
  const limit = Math.min(50, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 10));

  // If Upstash is not configured, just return an empty list gracefully
  if (!REDIS_URL || !REDIS_TOKEN) {
    return NextResponse.json({ events: [] }, { status: 200 });
  }

  try {
    const key = `cd:recent:${id}`;
    const start = 0;
    const stop = limit - 1;

    const res = await fetch(`${REDIS_URL}/lrange/${key}/${start}/${stop}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
      cache: "no-store",
    });

    if (!res.ok) {
      // Soft-fail: return empty events rather than erroring the build
      return NextResponse.json({ events: [] }, { status: 200 });
    }

    const json = await res.json();
    const arr: string[] = Array.isArray(json?.result) ? json.result : [];

    const events = arr
      .map((s) => {
        try {
          return JSON.parse(s);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    return NextResponse.json({ events }, { status: 200 });
  } catch {
    // Soft-fail on any network/JSON error
    return NextResponse.json({ events: [] }, { status: 200 });
  }
}
