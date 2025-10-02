// src/app/api/credits/holds/[id]/release/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { releaseHold } from "@/lib/credits/db";

const Body = z.object({
  reason: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const res = await releaseHold({ organizationId, holdId: id });
  if (!res.changed) return NextResponse.json({ released: false, message: "Hold not active" }, { status: 409 });

  return NextResponse.json({
    released: true,
    walletId: res.walletId,
    availableMinor: res.balances.available,
    onHoldMinor: res.balances.onHold,
    balanceMinor: res.balances.balance,
  });
}
