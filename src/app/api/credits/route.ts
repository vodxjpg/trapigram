// src/app/api/credits/holds/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireServerAuth } from "@/lib/credits/auth";
import { requireIdempotencyKey } from "@/lib/credits/idempotency";
import { toGBPMinor } from "@/lib/credits/currency";
import { ensureWallet, getBalances, findUserIdByExternalIdentity, createHold } from "@/lib/credits/db";

const Body = z.object({
  organizationId: z.string().min(1),
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3), // 'GBP' | 'USD'
  ttlSec: z.number().int().min(60).max(3600).optional(),
});

export async function POST(req: NextRequest) {
  const authErr = requireServerAuth(req);
  if (authErr) return authErr;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { organizationId, provider, providerUserId, orderId, amount, currency, ttlSec = 900 } =
    parsed.data;

  const userId = await findUserIdByExternalIdentity(organizationId, provider, providerUserId);
  if (!userId) {
    return NextResponse.json({ error: "User mapping not found (sync-code link required)" }, { status: 404 });
  }

  const wallet = await ensureWallet(organizationId, userId);
  const amountMinor = await toGBPMinor(amount, currency);

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
