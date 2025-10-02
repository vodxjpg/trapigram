// src/app/api/credits/refund/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/context";
import {
  ensureWallet,
  getBalances,
  insertLedgerEntry,
  findUserIdByExternalIdentity,
  findActiveHoldByOrder,
  releaseHold,
} from "@/lib/credits/db";
import { toGBPMinor } from "@/lib/credits/currency";

const Body = z.object({
  provider: z.literal("woocommerce"),
  providerUserId: z.string().min(1),
  orderId: z.string().min(1),
  amount: z.number().nonnegative(),
  currency: z.string().min(3).max(3), // 'GBP' | 'USD' | 'EUR'
  reason: z.string().optional(),
});

export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { provider, providerUserId, orderId, amount, currency, reason } = parsed.data;
  const userId = await findUserIdByExternalIdentity(organizationId, provider, providerUserId);
  if (!userId) return NextResponse.json({ error: "User mapping not found" }, { status: 404 });

  const wallet = await ensureWallet(organizationId, userId);

  // If a hold is still active for this order, release it (no debit captured).
  const active = await findActiveHoldByOrder({ organizationId, walletId: wallet.id as string, orderId });
  if (active) {
    const res = await releaseHold({ organizationId, holdId: active.id as string });
    return NextResponse.json({
      released: res.changed,
      walletId: wallet.id,
      availableMinor: res.balances.available,
      onHoldMinor: res.balances.onHold,
      balanceMinor: res.balances.balance,
    });
  }

  // Otherwise, refund by crediting back the provided amount.
  const amountMinor = await toGBPMinor(amount, currency);
  const { id } = await insertLedgerEntry({
    organizationId,
    walletId: wallet.id as string,
    direction: "credit",
    amountMinor,
    reason: "refund",
    reference: { provider, orderId, reason: reason ?? null },
    idempotencyKey: req.headers.get("idempotency-key") ?? crypto.randomUUID(),
  });

  const balances = await getBalances(organizationId, wallet.id as string);
  return NextResponse.json({
    entryId: id,
    walletId: wallet.id,
    availableMinor: balances.available,
    onHoldMinor: balances.onHold,
    balanceMinor: balances.balance,
  });
}
