// src/app/api/internal/generate-invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { Selectable } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

const MINT_ENDPOINT = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/niftipay-invoice`;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!;

export async function POST(req: NextRequest) {
  // ── 1) Auth
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // ── 2) Pick “today” and its day-of-month
  const url = new URL(req.url);
  const today = url.searchParams.get("date")
    ? new Date(url.searchParams.get("date")!)
    : new Date();
  const genDay = today.getUTCDate();

  console.log(
    `[generate-invoices] invoked for date=${today
      .toISOString()
      .slice(0, 10)} (day=${genDay})`
  );

  // ── 2a) Compute dueDate = today + 7 days
  const dueDateObj = new Date(today);
  dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 7);
  const due = dueDateObj.toISOString().slice(0, 10);

  // ── 3) Fetch all org-owners
  const owners = await db
    .selectFrom("member as m")
    .innerJoin("user as u", "u.id", "m.userId")
    .select(["m.userId as userId", "u.createdAt as createdAt"])
    .where("m.role", "=", "owner")
    .execute();

  console.log(`[generate-invoices] total owners fetched: ${owners.length}`);

  // ── 4) Only those whose signup-day matches today’s
  const eligible = owners.filter(({ createdAt }) => {
    const d = new Date(createdAt);
    return d.getUTCDate() === genDay && d < today;
  });
  console.log(
    `[generate-invoices] eligible owners (signup DOM === ${genDay}): ` +
      eligible.map((o) => o.userId).join(", ")
  );

  const created: Array<{
    id: string;
    userId: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: string;
    dueDate: string;
    createdAt: string;
  }> = [];

  // ── 5) Loop & invoice
  for (const { userId } of eligible) {
    // compute last-month window
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 1, genDay, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, genDay - 1, 23, 59, 59));
    const ps = start.toISOString().slice(0, 10);
    const pe = end.toISOString().slice(0, 10);

    console.log(`— user ${userId}: window ${ps} → ${pe}, due ${due}`);

    // skip if already invoiced
    const exists = await db
      .selectFrom("userInvoices")
      .select("id")
      .where("userId", "=", userId)
      .where("periodStart", "=", ps)
      .where("periodEnd", "=", pe)
      .executeTakeFirst();
    if (exists) {
      console.log(`  → skipping, invoice already exists (${exists.id})`);
      continue;
    }

    // sum up fees
    const sumRow = await db
      .selectFrom("orderFees")
      .select(sql<number>`coalesce(sum("feeAmount"), 0)`.as("total"))
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .executeTakeFirst();
    const total = Number(sumRow?.total ?? 0);
    console.log(`  → total fees for period: ${total}`);

      // For zero-fee users, still create a $0 invoice if there was activity (fee rows) in the window.
    let hasActivity = false;
    if (total <= 0) {
      const cntRow = await db
        .selectFrom("orderFees")
        .select(sql<number>`count(*)`.as("count"))
        .where("userId", "=", userId)
        .where("capturedAt", ">=", start)
        .where("capturedAt", "<=", end)
        .executeTakeFirst();
      const feeCount = Number(cntRow?.count ?? 0);
      hasActivity = feeCount > 0;
      if (!hasActivity) {
        console.log("  → skipping, no fee activity in this window");
        continue;
      }
      console.log("  → zero-amount invoice will be created (activity present)");
    }

    // insert invoice (now with paidAmount = 0)
    const inv = await db
      .insertInto("userInvoices")
      .values({
        id:                crypto.randomUUID(),
        userId,
        periodStart:       ps,
        periodEnd:         pe,
        totalAmount:       total,
        paidAmount:        0,
        // Auto-settle zero invoices; keep normal ones pending.
        status:            total > 0 ? "pending" : "paid",
        dueDate:           due,
        niftipayNetwork:   "ETH",
        niftipayAsset:     "USDT",
        niftipayOrderId:   null,
        niftipayReference: null,
        niftipayAddress:   null,
        niftipayQrUrl:     null,
        createdAt:         new Date(),
      })
      .returning([
        "id",
        "userId",
        "periodStart",
        "periodEnd",
        "totalAmount",
        "status",
        "dueDate",
        "createdAt",
      ])
      .executeTakeFirstOrThrow();

    console.log(`  → created invoice ${inv.id}`);

           // ── 6) Mint on-chain immediately (skip mint for zero-amount invoices)
     if (Number(inv.totalAmount) > 0) {
       try {
         await fetch(MINT_ENDPOINT, {
           method: "POST",
           headers: {
             "Content-Type":       "application/json",
             "x-internal-secret":  INTERNAL_SECRET,
           },
           body: JSON.stringify({ invoiceId: inv.id }),
         });
         console.log(`  → minted invoice ${inv.id} on Niftipay`);
       } catch (err) {
         console.error(`  → failed to mint invoice ${inv.id}:`, err);
       }
     } else {
       console.log(`  → skip mint (zero-amount invoice ${inv.id})`);
     }

    // attach each fee line-item
    const fees = await db
      .selectFrom("orderFees")
      .select(["id as orderFeeId", "feeAmount as amount"])
      .where("userId", "=", userId)
      .where("capturedAt", ">=", start)
      .where("capturedAt", "<=", end)
      .execute();

    console.log(`  → attaching ${fees.length} fee items`);
    for (const { orderFeeId, amount } of fees) {
      await db
        .insertInto("invoiceItems")
        .values({
          id:          crypto.randomUUID(),
          invoiceId:   inv.id,
          orderFeeId,
          amount,
        })
        .execute();
    }

    created.push({
      id:           inv.id,
      userId:       inv.userId,
      periodStart:  inv.periodStart,
      periodEnd:    inv.periodEnd,
      totalAmount:  inv.totalAmount.toString(),
      dueDate:      inv.dueDate,
      createdAt:    (inv.createdAt as Date).toISOString(),
    });
  }

  console.log(
    `[generate-invoices] done, created ${created.length} invoices`
  );
  return NextResponse.json({ invoices: created });
}
