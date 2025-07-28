// src/app/api/order/[id]/messages/sse-url/route.ts
import { NextResponse } from "next/server";
import { signedSseURL } from "@/lib/upstash";
import { getContext }   from "@/lib/context";   // ✅ optional auth

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  /* optional: reject if user has no permission to view this order */
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const url = signedSseURL(`order:${params.id}`);
  return NextResponse.json({ url });
}
