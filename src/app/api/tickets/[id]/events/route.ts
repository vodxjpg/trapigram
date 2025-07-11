// Server-Sent Events endpoint  →  GET /api/tickets/:id/events
import { NextRequest, NextResponse } from "next/server";
import { on } from "@/lib/ticket-events";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const stream = new ReadableStream({
    start(controller) {
      // ── keep the connection alive with 30 s comments ──
      const keepAlive = setInterval(() => {
        controller.enqueue(`: ping\n\n`);
      }, 30_000);

      // ── emit incoming messages ───────────────────────
      const off = on(id, (payload) => {
        controller.enqueue(`data: ${JSON.stringify(payload)}\n\n`);
      });

      // ── clean-up when client disconnects ─────────────
      controller.enqueue(`: connected to ticket ${id}\n\n`);
      return () => {
        clearInterval(keepAlive);
        off();                                         // unsubscribe
      };
    },
  });

  return new NextResponse(stream, {
    status: 200,
    headers: {
      "Content-Type":      "text/event-stream",
      "Cache-Control":     "no-cache",
      "Connection":        "keep-alive",
      "Access-Control-Allow-Origin": "*",             // dev convenience
    },
  });
}
