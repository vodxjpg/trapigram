// src/app/api/credits/sync-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { createSyncCode } from "@/lib/credits/sync";

const Body = z.object({
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
  email: z.string().email().optional(),
  // Accept 0 or omitted for "permanent". We ignore non-zero now for permanent codes.
  ttlSec: z.number().int().min(0).max(31536000).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { provider, providerUserId, email } = parsed.data;
  const res = await createSyncCode({
    organizationId,
    provider,
    providerUserId,
    email: email ?? null,
  });

  // If already linked, surface that so the Woo UI can message appropriately.
  if ("linked" in res && res.linked) {
    return NextResponse.json({ linked: true });
  }
  return NextResponse.json({ code: res.code, expiresAt: res.expiresAt });
}
