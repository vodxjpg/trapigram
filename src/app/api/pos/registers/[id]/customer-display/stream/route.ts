// /app/api/pos/registers/[id]/customer-display/stream/route.ts
import { NextRequest } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { subscribeLocal } from "@/lib/customer-display-bus";

export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: registerId } = await params;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return new Response("Missing sessionId", { status: 400 });

  // Ensure this session belongs to this register
  const { rows } = await pool.query(
    `SELECT 1 FROM registers WHERE id=$1 AND "displaySessionId"=$2 LIMIT 1`,
    [registerId, sessionId]
  );
  if (!rows.length) return new Response("Forbidden", { status: 403 });

  // If Pusher is configured, discourage using SSE
  if (
    process.env.PUSHER_APP_ID &&
    process.env.PUSHER_KEY &&
    process.env.PUSHER_SECRET &&
    process.env.PUSHER_CLUSTER
  ) {
    return new Response("Use Pusher client instead of SSE", { status: 410 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: any) =>
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));

      send({ type: "hello" });
      const ping = setInterval(() => send({ type: "ping", t: Date.now() }), 15000);

      const unsub = subscribeLocal(registerId, sessionId, (data) => send(data));

      (req as any).signal?.addEventListener?.("abort", () => {
        clearInterval(ping);
        unsub();
        controller.close();
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
