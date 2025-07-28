// src/app/api/order/[id]/messages/sse-url/route.ts
import { NextResponse } from "next/server";
import { signedSseURL } from "@/lib/upstash";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  /* OPTIONAL: auth check – ensure caller can view this order */
  const url = signedSseURL(`order:${params.id}`, 3600);
  return NextResponse.json({ url });
}
