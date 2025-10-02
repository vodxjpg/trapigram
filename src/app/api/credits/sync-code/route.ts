// src/app/api/credits/sync-code/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { createSyncCode } from "@/lib/credits/sync";

const Body = z.object({
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
  email: z.string().email().optional(),
  ttlSec: z.number().int().min(60).max(3600).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { provider, providerUserId, email, ttlSec } = parsed.data;
  const { code, expiresAt } = await createSyncCode({
    organizationId,
    provider,
    providerUserId,
    email: email ?? null,
    ttlSec,
  });
  return NextResponse.json({ code, expiresAt });
}
