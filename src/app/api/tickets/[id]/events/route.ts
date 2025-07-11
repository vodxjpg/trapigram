/* eslint-disable no-console */
export const runtime    = "nodejs";
export const revalidate = 0;

import { NextRequest }    from "next/server";
import { pgPool as pool } from "@/lib/db";
import type { ClientBase } from "pg";

/* ------------------------------------------------------------------------- */
/*  GET /api/tickets/[id]/events – server-sent events (SSE) stream           */
/* ------------------------------------------------------------------------- */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id }  = params;
  const chan    = `ticket_${id.replace(/-/g, "")}`;      // ticket_abcd…

  /* 1️⃣  open dedicated connection & attach listener *before* LISTEN ------ */
  const client: ClientBase = await pool.connect();

  const encoder = new TextEncoder();
  let heartbeat: NodeJS.Timeout;
  let ttl:       NodeJS.Timeout;
  let send:      (obj: unknown) => void;                 // defined in start()

  const onNotify = (msg: any) => {
    if (msg.channel !== chan) return;
    console.log(`Received notification on channel ${chan}:`, msg.payload);
    try {
      send(JSON.parse(msg.payload ?? "{}"));
    } catch {
      /* silently ignore malformed payloads */
    }
  };
  client.on("notification", onNotify);                   // attach first
  await client.query(`LISTEN ${chan}`);                  // no quotes → same name

  /* 2️⃣  Build the ReadableStream ---------------------------------------- */
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      send = (obj) =>
        controller.enqueue(encoder.encode(`data:${JSON.stringify(obj)}\n\n`));

      /* handshake – flush headers immediately so the browser opens the stream */
      controller.enqueue(encoder.encode(": connected\n\n"));

      /* heartbeat every 10 s keeps edge / proxies from idling the connection */
      heartbeat = setInterval(() =>
        controller.enqueue(encoder.encode(": ping\n\n")), 10_000);

      /* auto-close after 25 s; browser will reconnect */
      ttl = setTimeout(close, 25_000);

      /* tidy-up helper (used by ttl *and* cancel) */
      function close() {
        clearInterval(heartbeat);
        clearTimeout(ttl);
        client.off("notification", onNotify);
        client.release();
        controller.close();
      }

      /* if client aborts early (tab closed, route change, …) */
      controller.signal.addEventListener("abort", close);
    },
  });

  /* 3️⃣  Return the SSE response ----------------------------------------- */
  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
