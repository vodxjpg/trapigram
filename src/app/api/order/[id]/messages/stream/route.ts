import { NextRequest } from "next/server";
export const runtime = "edge";

const URL   = process.env.UPSTASH_REDIS_REST_URL!;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN!;

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;
  if (!URL || !TOKEN) return new Response("Redis not configured", { status: 500 });

  /* ── 1. open the Upstash streaming endpoint ───────────────────────── */
  const upstream = await fetch(`${URL}/subscribe/order:${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    cache:   "no-store",
  });
  if (!upstream.ok || !upstream.body)
    return new Response("Upstash error", { status: 502 });

  /* ── 2. bridge → SSE with heart‑beats ─────────────────────────────── */
  const enc   = new TextEncoder();
  const dec   = new TextDecoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  /* 2‑a: send an initial comment so headers flush instantly */
  await writer.write(enc.encode(`: hello\n\n`));

  /* 2‑b: heartbeat every 25 s so CF never closes the pipe */
  const ping = setInterval(() => {
    writer.write(enc.encode(`: ping\n\n`));
  }, 25_000);

  (async () => {
    const reader = upstream.body!.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        // Upstash delivers \n‑delimited JSON strings. Split in case of coalesced chunks.
        dec.decode(value)
           .split("\n")
           .filter(Boolean)
           .forEach(line =>
             writer.write(enc.encode(`data: ${line}\n\n`))
           );
      }
    } finally {
      clearInterval(ping);
      writer.close();
    }
  })();

  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
