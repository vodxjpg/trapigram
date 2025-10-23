// src/app/api/tickets/[id]/messages/stream/route.ts
import { NextRequest } from "next/server";

export const runtime = "edge";

const URL = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is async
) {
  const { id } = await context.params;

  if (!URL || !TOKEN) {
    return new Response("Redis not configured", { status: 500 });
  }

  const upstream = await fetch(`${URL}/subscribe/ticket:${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    return new Response("Upstash error", { status: 502 });
  }

  const { readable, writable } = new TransformStream();
  (async () => {
    const reader = upstream.body!.getReader();
    const writer = writable.getWriter();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
    } finally {
      writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}
