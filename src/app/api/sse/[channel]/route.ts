import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ channel: string }> } // ⬅️ Next 16
) {
  const { channel } = await context.params;
  const url = `${process.env.UPSTASH_REDIS_REST_URL}/subscribe/${channel}`;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!token) {
    console.error("[SSE Proxy] Authentication token is missing");
    return NextResponse.json({ error: "Authentication token is missing" }, { status: 500 });
  }

  const upstream = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  if (!upstream.ok || !upstream.body) {
    console.error("[SSE Proxy] Failed to subscribe to Upstash:", upstream.statusText);
    return NextResponse.json(
      { error: "Failed to subscribe to Upstash" },
      { status: upstream.status }
    );
  }

  const reader = upstream.body.getReader();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
