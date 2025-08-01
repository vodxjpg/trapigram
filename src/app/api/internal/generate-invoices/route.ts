// src/app/api/internal/generate-invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

export async function POST(req: NextRequest) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const today = dateParam ? new Date(dateParam) : new Date();
  const genDay = today.getUTCDate();

  // 1️⃣ fetch distinct owner users of any org
  const owners = await db
    .selectFrom('"organization" as o')
    .innerJoin('"tenant" as t', sql`(o."metadata"->>'tenantId')::text`, 't.id')
    .innerJoin('"user" as u', 'u."id"', 't."ownerUserId"')
    .select(['t."ownerUserId" as userId', 'u."createdAt"'])
    .distinct()
    .execute();

  // 2️⃣ filter by join-day and account-age
  const eligible = owners.filter(
    ({ createdAt }) =>
      new Date(createdAt).getUTCDate() === genDay &&
      new Date(createdAt) < today
  );

  const createdInvoices: Array<{
    id: string;
    userId: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    dueDate: string;
    createdAt: string;
  }> = [];

  for (const { userId } of eligible) {
    // compute billing window
    const year = today.getUTCFullYear();
    const month = today.getUTCMonth();
    const periodStart = new Date(Date.UTC(year, month - 1, genDay, 0, 0, 0));
    const periodEnd = new Date(Date.UTC(year, month, genDay - 1, 23, 59, 59));

    // skip existing
    const exists = await db
      .selectFrom('"userInvoices"')
      .select('id')
      .where('"userId"', '=', userId)
      .where('"periodStart"', '=', periodStart)
      .where('"periodEnd"', '=', periodEnd)
      .executeTakeFirst();
    if (exists) continue;

    // sum all fees across all orgs for this user
    const sumRow = await db
      .selectFrom('"orderFees"')
      .select(sql<number>`coalesce(sum("feeAmount"),0)`.as('sum'))
      .where('"userId"', '=', userId)
      .where('"capturedAt"', '>=', periodStart)
      .where('"capturedAt"', '<=', periodEnd)
      .executeTakeFirst();
    const totalAmount = sumRow?.sum ?? 0;
    if (totalAmount === 0) continue;

    // insert invoice
    const invoice = await db
      .insertInto('"userInvoices"')
      .values({
        "userId": userId,
        "periodStart": periodStart,
        "periodEnd": periodEnd,
        "totalAmount": totalAmount,
        "dueDate": today,
      })
      .returning([
        '"id"', '"userId"', '"periodStart"', '"periodEnd"',
        '"totalAmount"', '"status"', '"dueDate"', '"createdAt"'
      ])
      .executeTakeFirstOrThrow();

    // attach all fee items
    const fees = await db
      .selectFrom('"orderFees"')
      .select(['"id"', '"feeAmount"'])
      .where('"userId"', '=', userId)
      .where('"capturedAt"', '>=', periodStart)
      .where('"capturedAt"', '<=', periodEnd)
      .execute();

    for (const fee of fees) {
      await db
        .insertInto('"invoiceItems"')
        .values({
          "invoiceId": invoice.id,
          "orderFeeId": fee.id,
          "amount": fee.feeAmount
        })
        .execute();
    }

    createdInvoices.push({
      id: invoice.id,
      userId: invoice.userId,
      periodStart: invoice.periodStart.toISOString(),
      periodEnd: invoice.periodEnd.toISOString(),
      totalAmount: invoice.totalAmount.toString(),
      dueDate: invoice.dueDate.toISOString().split("T")[0],
      createdAt: invoice.createdAt.toISOString(),
    });
  }

  return NextResponse.json({ invoices: createdInvoices });
}
