/* eslint-disable no-console */
export const runtime = "nodejs";
export const revalidate = 0;

import { NextRequest } from "next/server";
import { pgPool as pool } from "@/lib/db";
import type { ClientBase } from "pg";

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

  let pingId: NodeJS.Timeout;   // ← hoisted so cancel() can see them
  let ttlId:  NodeJS.Timeout;
  
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data:${JSON.stringify(obj)}\n\n`));
  
      /* ── heartbeat ───────────────────────────────────────────── */
      pingId = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 10_000);
  
      /* ── pg NOTIFY handler ───────────────────────────────────── */
      client.on("notification", (msg) => {
        if (msg.channel !== chan) return;
        try   { send(JSON.parse(msg.payload ?? "{}")); }
        catch { /* ignore malformed */ }
      });
  
      /* ── auto-close after 25 s (client will reconnect) ───────── */
      ttlId = setTimeout(() => {
        clearInterval(pingId);
        controller.close();
        client.release();
      }, 25_000);
    },
  
    /* **This** is what the stream implementation calls on Abort / GC */
    cancel() {
      clearInterval(pingId);
      clearTimeout(ttlId);
      client.release();
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
