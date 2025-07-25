// src/app/api/tickets/[id]/messages/stream/route.ts
import { NextRequest } from "next/server";

export const runtime = "edge";

const URL   = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  if (!URL || !TOKEN) {
    return new Response("Redis not configured", { status: 500 });
  }
  // Proxy Upstash SSE so token never reaches browser
  const upstream = await fetch(`${URL}/subscribe/ticket:${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
