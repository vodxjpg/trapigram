// src/app/api/pos/registers/[id]/customer-display/stream/route.ts
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

  // Verify this session belongs to this register
  const { rows } = await pool.query(
    `SELECT 1 FROM registers WHERE id=$1 AND "displaySessionId"=$2 LIMIT 1`,
    [registerId, sessionId]
  );
  if (!rows.length) return new Response("Forbidden", { status: 403 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      // hello + keepalive
      send({ type: "hello" });
      const ping = setInterval(() => send({ type: "ping", t: Date.now() }), 15000);

      // Subscribe to in-memory bus
      const unsub = subscribeLocal(registerId, sessionId, (data) => send(data));

      // Close on client disconnect
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
