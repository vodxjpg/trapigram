import { NextResponse } from "next/server";
import { sseURL } from "@/lib/upstash";

/**
 * GET /api/order/[id]/messages/sse-url
 *
 * Returns a JSON payload: { url: "https://…/sse/…?topic=order:<id>" }
 * that the front‑end can feed into `new EventSource(url)`.
 *
 * You may add whatever auth / permission checks you need before
 * returning the URL.
 */
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // TODO: enforce permissions here if required

  const url = sseURL(`order:${params.id}`);   // read‑only stream URL
  return NextResponse.json({ url });
}
