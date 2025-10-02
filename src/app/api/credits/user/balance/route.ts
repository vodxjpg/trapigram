// src/app/api/credits/user/balance/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { ensureWallet, getBalances, findUserIdByExternalIdentity } from "@/lib/credits/db";
import { minorToDecimalString } from "@/lib/credits/calc";

/** Server-to-server balance lookup by providerUserId (Woo user id). */
const Body = z.object({
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { provider, providerUserId } = parsed.data;

  const userId = await findUserIdByExternalIdentity(organizationId, provider, providerUserId);
  if (!userId) {
    return NextResponse.json({ error: "User mapping not found" }, { status: 404 });
  }

  const wallet = await ensureWallet(organizationId, userId);
  const balances = await getBalances(organizationId, wallet.id as string);

  return NextResponse.json({
    walletId: wallet.id,
    currency: "GEMS",
    availableMinor: balances.available,
    onHoldMinor: balances.onHold,
    balanceMinor: balances.balance,
    available: minorToDecimalString(balances.available),
    onHold: minorToDecimalString(balances.onHold),
    balance: minorToDecimalString(balances.balance),
  });
}
