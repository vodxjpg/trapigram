// src/app/api/order/[id]/messages/stream/route.ts
import { NextRequest } from "next/server";

/* --------- runtime --------- */
// ⬇️ Edge cannot forward Upstash’s streaming response.
// Comment out the edge flag (or set explicit node).
// export const runtime = "edge";
export const runtime = "nodejs";

/* ── env ───────────────────────────────────────────── */
const URL   = process.env.UPSTASH_REDIS_REST_URL?.trim()!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()!;

/* ── Node bridge → Upstash → browser (SSE) ─────────── */
export function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  if (!URL || !TOKEN) {
    return new Response("Redis not configured", { status: 500 });
  }

  const { id } = params;
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  queueMicrotask(async () => {
    await writer.write(enc.encode(": hello\n\n"));

    const upstream = await fetch(`${URL}/subscribe/order:${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache:   "no-store",
    }).catch(() => null);

    if (!upstream?.ok || !upstream.body) {
      await writer.write(enc.encode("event: error\ndata: upstash\n\n"));
      writer.close();
      return;
    }

    const hb = setInterval(
      () => writer.write(enc.encode(": ping\n\n")),
      25_000,
    );

    const reader = upstream.body.getReader();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop()!;              // last partial (or "")
        for (const line of lines) {
          if (!line) continue;
          await writer.write(enc.encode(`data: ${line}\n\n`));
        }
      }
    } finally {
      clearInterval(hb);
      writer.close();
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
