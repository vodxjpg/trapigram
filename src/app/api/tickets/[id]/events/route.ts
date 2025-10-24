/* eslint-disable no-console */
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { pgPool as pool } from "@/lib/db";
import type { ClientBase } from "pg";

/* ------------------------------------------------------------------------- */
/*  GET /api/tickets/[id]/events – server-sent events (SSE) stream           */
/* ------------------------------------------------------------------------- */
export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> } // ⬅️ Next 16: params is a Promise
) {
  const { id } = await context.params;
  const chan = `ticket_${id.replace(/-/g, "")}`; // ticket_abcd…

  // 1) open dedicated connection & attach listener BEFORE LISTEN
  const client: ClientBase = await pool.connect();

  const encoder = new TextEncoder();
  let heartbeat: NodeJS.Timeout;
  let ttl: NodeJS.Timeout;

  const onNotify = (msg: any, send: (obj: unknown) => void) => {
    if (msg.channel !== chan) return;
    try {
      send(JSON.parse(msg.payload ?? "{}"));
    } catch {
      // ignore malformed payloads
    }
  };

  // LISTEN on channel (unquoted identifier is fine for [a-z_0-9])
  client.on("error", (e: unknown) => console.error("[SSE client error]", e));
  await client.query(`LISTEN ${chan}`);

  // 2) Build the ReadableStream
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data:${JSON.stringify(obj)}\n\n`));

      // Attach notification handler now that we have send()
      const handler = (msg: any) => onNotify(msg, send);
      // @ts-ignore pg types: PoolClient emits 'notification'
      client.on("notification", handler);

      // initial handshake
      controller.enqueue(encoder.encode(": connected\n\n"));

      // heartbeat every 10s
      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);

      // auto-close after 25s; browser can reconnect
      ttl = setTimeout(close, 25_000);

      function close() {
        clearInterval(heartbeat);
        clearTimeout(ttl);
        // @ts-ignore
        client.off?.("notification", handler);
        // Best-effort UNLISTEN (don't throw if it fails)
        client.query(`UNLISTEN ${chan}`).catch(() => { });
        // Release back to pool
        // @ts-ignore PoolClient has release()
        client.release?.();
        controller.close();
      }

      // if client aborts (tab closed, route change, etc.)
      _req.signal.addEventListener("abort", close);
    },
  });

  // 3) Return the SSE response
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
