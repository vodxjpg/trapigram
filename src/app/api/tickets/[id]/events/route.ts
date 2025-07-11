/* eslint-disable no-console */
export const runtime = "nodejs";
export const revalidate = 0;

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

const normaliseRow = (r: DbRow) => ({
  id: r.id,
  message: r.message,
  attachments: r.attachments ? JSON.parse(r.attachments) : [],
  isInternal: r.isinternal ?? r.isInternal,
  createdAt: r.createdat ?? r.createdAt,
});

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const { id } = params;

  const client = await pool.connect();
  const chan   = `ticket_${id.replace(/-/g, "")}`;
  await client.query(`LISTEN "${chan}"`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: object) =>
        controller.enqueue(encoder.encode(`data:${JSON.stringify(data)}\n\n`));

      /* heartbeat so the connection stays open on some proxies */
      const ping = setInterval(() => {
        controller.enqueue(encoder.encode(": ping\n\n"));
      }, 10_000);

      client.on("notification", (msg) => {
        if (msg.channel !== chan) return;
        try {
          send(normaliseRow(JSON.parse(msg.payload ?? "{}")));
        } catch {
          console.warn("Malformed NOTIFY payload");
        }
      });

      /* close after 25 s – browser will auto-reconnect */
      const ttl = setTimeout(() => {
        clearInterval(ping);
        controller.close();
        client.release();
      }, 25_000);

      /* clean-up if consumer cancels earlier */
      return {
        cancel() {
          clearTimeout(ttl);
          clearInterval(ping);
          client.release();
        },
      };
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
