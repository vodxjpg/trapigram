/* eslint-disable no-console */
// Edge-runtime, streaming response
/* eslint-disable no-console */
// Needs full Node.js runtime because we rely on the native `pg` driver,
// which pulls in `fs`, `path`, `stream`, … – all unavailable on Edge.
export const runtime = "nodejs";
export const revalidate = 0;           // never cache

import { NextRequest } from "next/server";
import { pgPool as pool } from "@/lib/db";

type DbRow = {
  id: string;
  ticketId: string;
  message: string;
  attachments: string;
  isInternal: boolean;
  createdAt: string;
};

/**
 * Very small helper to transform a DB row into the shape
 * we already expect on the client side.
 */
const normaliseRow = (r: DbRow) => ({
  id:         r.id,
  message:    r.message,
  attachments:r.attachments ? JSON.parse(r.attachments) : [],
  isInternal: r.isinternal ?? r.isInternal,
  createdAt:  r.createdat  ?? r.createdAt,
});

export async function GET(req: NextRequest,
                          { params }: { params: { id: string } }) {
  const { id } = params;

  // 1️⃣ open a Postgres LISTEN/NOTIFY channel for this ticket
  // Each insert on ticketMessages should NOTIFY this channel
  const client = await pool.connect();
  const chan   = `ticket_${id.replace(/-/g, "")}`;
  await client.query(`LISTEN "${chan}"`);

  const encoder = new TextEncoder();

  // 2️⃣ build a ReadableStream that pushes events
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) => {
        controller.enqueue(encoder.encode(`data:${JSON.stringify(data)}\n\n`));
      };

      // --- heartbeat every 10 s so the edge runtime stays “busy”
      const ping = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);

      // --- pg NOTIFY handler
      client.on("notification", async (msg) => {
        if (msg.channel !== chan) return;
        try {
          const row = JSON.parse(msg.payload ?? "{}") as DbRow;
          send(normaliseRow(row));
        } catch (e) {
          console.warn("Malformed NOTIFY payload", e);
        }
      });

      // --- close after 25 s (browser reconnects automatically)
      const ttl = setTimeout(() => {
        clearInterval(ping);
        controller.close();
        client.release();
      }, 25_000);

      // Make sure we clean everything if consumer cancels early
      controller.signal.addEventListener("abort", () => {
        clearTimeout(ttl);
        clearInterval(ping);
        client.release();
      });
    },
  });

  // 3️⃣ return the streaming Response
  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      Connection:      "keep-alive",
    },
  });
}
