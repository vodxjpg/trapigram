// src/app/api/internal/generate-invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 1️⃣ Auth
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // 2️⃣ Parse optional date param (YYYY-MM-DD)
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const today = dateParam ? new Date(dateParam) : new Date();
  const genDay = today.getUTCDate();

  // 3️⃣ Fetch all organization owners via tenant metadata
  const owners = await db
    .selectFrom("organization as o")
    .innerJoin(
      "tenant as t",
      "(o.metadata::json->>'tenantId')::text",
      "=",
      "t.id"
    )
    .innerJoin("user as u", "u.id", "=", "t.ownerUserId")
    .select(["t.ownerUserId as userId", "u.createdAt"])
    .distinct()
    .execute();

  // 4️⃣ Filter owners by signup day
  const eligible = owners.filter(({ createdAt }) => {
    const joined = new Date(createdAt);
    return joined.getUTCDate() === genDay && joined < today;
  });

  const createdInvoices: Array<{
    id: string;
    userId: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    dueDate: string;
    createdAt: string;
  }> = [];

  // 5️⃣ Loop through each eligible owner
  for (const { userId } of eligible) {
    // Compute last month billing window
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const start = new Date(Date.UTC(year, month - 1, genDay, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, genDay - 1, 23, 59, 59));

    // Skip if invoice already exists
    const exists = await db
      .selectFrom("userInvoices")
      .select("id")
      .where("userId", "=", userId)
      .where("periodStart", "=", start)
      .where("periodEnd", "=", end)
      .executeTakeFirst();
    if (exists) continue;

    // Sum fees for user in period
    const sumRow = await db
      .selectFrom("orderFees")
      .select(sql<number>`coalesce(sum("feeAmount"), 0)`.as('sum'))
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .executeTakeFirst();

    const total = sumRow?.sum ?? 0;
    if (total <= 0) continue;

    // Insert invoice header
    const invoice = await db
      .insertInto("userInvoices")
      .values({
        id: crypto.randomUUID(),
        userId,
        periodStart: start,
        periodEnd: end,
        totalAmount: total,
        status: 'pending',
        dueDate: today,
        niftipayNetwork: 'ETH',
        niftipayAsset: 'USDT'
      })
      .returning([
        'id','userId','periodStart','periodEnd',
        'totalAmount','status','dueDate','createdAt'
      ])
      .executeTakeFirstOrThrow();

    // Attach each fee as an invoice item
    const fees = await db
      .selectFrom("orderFees")
      .select(['id as orderFeeId','feeAmount as amount'])
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .execute();

    for (const { orderFeeId, amount } of fees) {
      await db
        .insertInto("invoiceItems")
        .values({
          id: crypto.randomUUID(),
          invoiceId: invoice.id,
          orderFeeId,
          amount
        })
        .execute();
    }

    createdInvoices.push({
      id: invoice.id,
      userId: invoice.userId,
      periodStart: (invoice.periodStart as Date).toISOString(),
      periodEnd:   (invoice.periodEnd as Date).toISOString(),
      totalAmount: invoice.totalAmount.toString(),
      dueDate:     (invoice.dueDate as Date).toISOString().split('T')[0],
      createdAt:   (invoice.createdAt as Date).toISOString(),
    });
  }

  return NextResponse.json({ invoices: createdInvoices });
}
