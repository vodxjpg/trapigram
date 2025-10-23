// src/app/api/order/[id]/messages/stream/route.ts
import { NextRequest } from "next/server";

/* --------- runtime --------- */
export const runtime = "nodejs";

/* ── env ───────────────────────────────────────────── */
const URL   = process.env.UPSTASH_REDIS_REST_URL?.trim()!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()!;

/* ── Node bridge → Upstash → browser (SSE) ─────────── */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> } // Next 16: params is a Promise
) {
  if (!URL || !TOKEN) {
    return new Response("Redis not configured", { status: 500 });
  }

  const { id } = await context.params;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // Close helpers
  let hb: ReturnType<typeof setInterval> | null = null;
  const close = async () => {
    if (hb) clearInterval(hb);
    try { await writer.close(); } catch {}
  };

  // Abort if the client disconnects
  req.signal.addEventListener("abort", close);

  queueMicrotask(async () => {
    await writer.write(enc.encode(": hello\n\n"));

    const upstream = await fetch(`${URL}/subscribe/order:${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache:   "no-store",
      signal:  req.signal,
    }).catch(() => null);

    if (!upstream?.ok || !upstream.body) {
      await writer.write(enc.encode("event: error\ndata: upstash\n\n"));
      await close();
      return;
    }

    hb = setInterval(() => {
      writer.write(enc.encode(": ping\n\n")).catch(() => {});
    }, 25_000);

    const reader = upstream.body.getReader();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line) continue;
          await writer.write(enc.encode(`data: ${line}\n\n`));
        }
      }
    } finally {
      await close();
    }
  });

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
