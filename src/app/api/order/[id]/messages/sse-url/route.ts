// src/app/api/order/[id]/messages/sse-url/route.ts
import { NextResponse } from "next/server";
import { sseURL } from "@/lib/upstash";

export const runtime = "nodejs";

/**
 * GET /api/order/[id]/messages/sse-url
 * Returns { url } for EventSource.
 */
export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  // TODO: permission checks if needed
  const url = sseURL(`order:${id}`);
  return NextResponse.json({ url });
}
