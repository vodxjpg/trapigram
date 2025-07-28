import { NextRequest } from "next/server";
export const runtime = "edge";

/* ── env ────────────────────────────────────────────── */
const URL   = process.env.UPSTASH_REDIS_REST_URL?.trim()!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN?.trim()!;

/* ── Edge bridge → Upstash → browser (SSE) ──────────── */
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

  /* 1. start streaming immediately so Vercel is happy    */
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  /* 2. do the slow work *after* the Response has been returned */
  queueMicrotask(async () => {
    /* flush headers */
    await writer.write(enc.encode(": hello\n\n"));

    /* connect to Upstash */
    const upstream = await fetch(`${URL}/subscribe/order:${id}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      cache:   "no-store",
    }).catch(() => null);

    if (!upstream?.ok || !upstream.body) {
      await writer.write(enc.encode("event: error\ndata: upstash\n\n"));
      writer.close();
      return;
    }

    /* heartbeat so Cloudflare/Vercel never time‑out (25 s < 100 s) */
    const hb = setInterval(
      () => writer.write(enc.encode(": ping\n\n")),
      25_000,
    );

    const reader = upstream.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        dec.decode(value)
           .split("\n")         // Upstash sends one JSON per line
           .filter(Boolean)
           .forEach(line =>
             writer.write(enc.encode(`data: ${line}\n\n`)),
           );
      }
    } finally {
      clearInterval(hb);
      writer.close();
    }
  });

  /* 3. return the stream right away                     */
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
