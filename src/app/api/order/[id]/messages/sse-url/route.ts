import { NextResponse } from "next/server";
import { signedSseURL } from "@/lib/upstash";

// Node runtime (needs crypto); do NOT mark as `"edge"`
export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  // todo: add your auth/permissions check here …
  const url = signedSseURL(`order:${params.id}`, 3600); // 1 h validity
  return NextResponse.json({ url });
}