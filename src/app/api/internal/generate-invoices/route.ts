// src/app/api/internal/generate-invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // pick a “today” (from ?date=) and its day-of-month
  const url = new URL(req.url);
  const today = url.searchParams.get("date")
    ? new Date(url.searchParams.get("date")!)
    : new Date();
  const genDay = today.getUTCDate();

  // 1️⃣ pull every member with role='owner'
  const owners = await db
    .selectFrom("member as m")
    .innerJoin("user as u", "u.id", "m.userId")
    .select([
      "m.userId as userId",
      "u.createdAt as createdAt",
    ])
    .where("m.role", "=", "owner")
    .execute();

  // 2️⃣ only keep those whose signup‐day matches today’s DOM
  const eligible = owners.filter(({ createdAt }) => {
    const d = new Date(createdAt);
    return d.getUTCDate() === genDay && d < today;
  });

  const created: Array<{
    id: string;
    userId: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    dueDate: string;
    createdAt: string;
  }> = [];

  for (const { userId } of eligible) {
    // build last‐month window [genDay‐1 → genDay‐2]
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 1, genDay,      0, 0,  0));
    const end   = new Date(Date.UTC(y, m,     genDay - 1, 23, 59, 59));
    const ps = start.toISOString().slice(0, 10);
    const pe = end.toISOString().slice(0, 10);
    const due = today.toISOString().slice(0, 10);

    // skip if we’ve already invoiced this user for that period
    const exists = await db
      .selectFrom("userInvoices")
      .select("id")
      .where("userId", "=", userId)
      .where("periodStart", "=", ps)
      .where("periodEnd", "=", pe)
      .executeTakeFirst();
    if (exists) continue;

    // sum up fees in that window
    const sumRow = await db
      .selectFrom("orderFees")
      .select(sql<number>`coalesce(sum("feeAmount"), 0)`.as("total"))
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .executeTakeFirst();
    const total = sumRow?.total ?? 0;
    if (total <= 0) continue;

    // create the invoice
    const inv = await db
      .insertInto("userInvoices")
      .values({
        id: crypto.randomUUID(),
        userId,
        periodStart: ps,
        periodEnd:   pe,
        totalAmount: total,
        status:      "pending",
        dueDate:     due,
        niftipayNetwork: "ETH",
        niftipayAsset:   "USDT",
      })
      .returning([
        "id","userId","periodStart","periodEnd",
        "totalAmount","status","dueDate","createdAt",
      ])
      .executeTakeFirstOrThrow();

    // attach each fee
    const fees = await db
      .selectFrom("orderFees")
      .select(["id as orderFeeId", "feeAmount as amount"])
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .execute();

    for (const { orderFeeId, amount } of fees) {
      await db
        .insertInto("invoiceItems")
        .values({
          id: crypto.randomUUID(),
          invoiceId: inv.id,
          orderFeeId,
          amount,
        })
        .execute();
    }

    created.push({
      id: inv.id,
      userId: inv.userId,
      periodStart: inv.periodStart,
      periodEnd:   inv.periodEnd,
      totalAmount: inv.totalAmount.toString(),
      dueDate:     inv.dueDate,
      createdAt:   (inv.createdAt as Date).toISOString(),
    });
  }

  return NextResponse.json({ invoices: created });
}
