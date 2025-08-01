import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 1️⃣ Require internal auth
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // 2️⃣ Parse optional 'date' query param (YYYY-MM-DD)
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const today = dateParam ? new Date(dateParam) : new Date();
  const dayOfMonth = today.getUTCDate();

  // 3️⃣ Fetch organization owners via tenant metadata
  const owners = await db
    .selectFrom('organization as o')
    .innerJoin('tenant as t', (join) =>
      join.on(sql`(o.metadata::json->>'tenantId')::text`, '=', 't.id')
    )
    .innerJoin('user as u', 'u.id', 't.ownerUserId')
    .select(['t.ownerUserId as userId', 'u.createdAt as createdAt'])
    .distinct()
    .execute();

  // 4️⃣ Filter by signup day
  const eligible = owners.filter(({ createdAt }) => {
    const joinedDate = new Date(createdAt);
    return joinedDate.getUTCDate() === dayOfMonth && joinedDate < today;
  });

  const generated: Array<Record<string, string>> = [];

  // 5️⃣ For each eligible owner, build invoice
  for (const { userId } of eligible) {
    // Billing window: from last month's dayOfMonth start to this month's dayOfMonth-1 end
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const startDate = new Date(Date.UTC(year, month - 1, dayOfMonth, 0, 0, 0));
    const endDate = new Date(Date.UTC(year, month, dayOfMonth - 1, 23, 59, 59));
    const periodStart = startDate.toISOString().split('T')[0];
    const periodEnd = endDate.toISOString().split('T')[0];
    const dueDate = today.toISOString().split('T')[0];

    // Skip if already invoiced
    const exists = await db
      .selectFrom('userInvoices')
      .select('id')
      .where('userId', '=', userId)
      .where('periodStart', '=', periodStart)
      .where('periodEnd', '=', periodEnd)
      .executeTakeFirst();

    if (exists) continue;

    // Sum all fees in window
    const sumRow = await db
      .selectFrom('orderFees')
      .select(sql<number>`coalesce(sum("feeAmount"),0)`.as('total'))
      .where('userId', '=', userId)
      .where('capturedAt', '>=', startDate)
      .where('capturedAt', '<=', endDate)
      .executeTakeFirst();

    const totalAmount = sumRow?.total ?? 0;
    if (totalAmount <= 0) continue;

    // Create invoice header
    const invoice = await db
      .insertInto('userInvoices')
      .values({
        id: crypto.randomUUID(),
        userId,
        periodStart,
        periodEnd,
        totalAmount: totalAmount.toString(),
        status: 'pending',
        dueDate,
        niftipayNetwork: 'ETH',
        niftipayAsset: 'USDT',
      })
      .returning([
        'id', 'userId', 'periodStart', 'periodEnd',
        'totalAmount', 'status', 'dueDate', 'createdAt'
      ])
      .executeTakeFirstOrThrow();

    // Attach fee items
    const fees = await db
      .selectFrom('orderFees')
      .select(['id as orderFeeId', 'feeAmount as amount'])
      .where('userId', '=', userId)
      .where('capturedAt', '>=', startDate)
      .where('capturedAt', '<=', endDate)
      .execute();

    for (const { orderFeeId, amount } of fees) {
      await db
        .insertInto('invoiceItems')
        .values({
          id: crypto.randomUUID(),
          invoiceId: invoice.id,
          orderFeeId,
          amount,
        })
        .execute();
    }

    // Collect for response
    generated.push({
      id: invoice.id,
      userId: invoice.userId,
      periodStart: invoice.periodStart,
      periodEnd: invoice.periodEnd,
      totalAmount: invoice.totalAmount,
      dueDate: invoice.dueDate,
      createdAt: invoice.createdAt.toISOString(),
    });
  }

  return NextResponse.json({ invoices: generated });
}