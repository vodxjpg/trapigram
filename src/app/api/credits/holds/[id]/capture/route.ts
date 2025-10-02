// src/app/api/credits/holds/[id]/capture/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { requireIdempotencyKey } from "@/lib/credits/idempotency";
import { captureHold } from "@/lib/credits/db";

const Body = z.object({}); // no body fields required

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const [idempotencyKey, idemErr] = requireIdempotencyKey(req);
  if (idemErr) return idemErr;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await captureHold({ organizationId, holdId: id, idempotencyKey });
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });

  return NextResponse.json({
    captured: true,
    walletId: res.walletId,
    availableMinor: res.balances.available,
    onHoldMinor: res.balances.onHold,
    balanceMinor: res.balances.balance,
  });
}
