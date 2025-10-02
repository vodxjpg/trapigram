// src/app/api/credits/holds/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import { toGBPMinor } from "@/lib/credits/currency";
import { ensureWallet, getBalances, findUserIdByExternalIdentity, createHold } from "@/lib/credits/db";

const Body = z.object({
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3), // 'GBP' | 'USD' | 'EUR'
  ttlSec: z.number().int().min(60).max(3600).optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { provider, providerUserId, orderId, amount, currency, ttlSec = 900 } = parsed.data;

  const userId = await findUserIdByExternalIdentity(organizationId, provider, providerUserId);
  if (!userId) {
    return NextResponse.json({ error: "User mapping not found (sync-code link required)" }, { status: 404 });
  }

  const wallet = await ensureWallet(organizationId, userId);
  const amountMinor = await toGBPMinor(amount, currency);

  // ⛔ Ensure sufficient available balance before creating the hold
  const before = await getBalances(organizationId, wallet.id as string);
  if (amountMinor > before.available) {
    return NextResponse.json(
      {
        error: "Insufficient credits",
        availableMinor: before.available,
        requestedMinor: amountMinor,
      },
      { status: 409 },
    );
  }

  const { holdId, expiresAt } = await createHold({
    organizationId,
    walletId: wallet.id as string,
    provider,
    orderId,
    amountMinor,
    ttlSec,
  });

  const balances = await getBalances(organizationId, wallet.id as string);

  return NextResponse.json({
    holdId,
    expiresAt,
    walletId: wallet.id,
    currency: "GEMS",
    availableMinor: balances.available,
    onHoldMinor: balances.onHold,
    balanceMinor: balances.balance,
  });
}
