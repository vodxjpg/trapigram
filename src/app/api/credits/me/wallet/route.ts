// src/app/api/credits/me/wallet/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getContext } from "@/lib/context";
import { ensureWallet, getBalances } from "@/lib/credits/db";
import { minorToDecimalString } from "@/lib/credits/calc";

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId, userId } = ctx as any;
  if (!organizationId || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
