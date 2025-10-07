// src/app/api/internal/generate-invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import type { Selectable } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

/**
 * Endpoint purpose:
 * - Generates monthly invoices per user (org owners) on their signup day-of-month.
 * - Only includes fees from orders that are PAID-LIKE, or were canceled/refunded AFTER a grace window.
 * - Skips minting zero-amount invoices (but still creates them if there was activity).
 *
 * Auth:
 * - GET/POST both supported.
 * - Vercel Cron is allowed via `x-vercel-cron: 1`.
 * - Otherwise requires `x-internal-secret: <INTERNAL_API_SECRET>`.
 *
 * Testing:
 * - You can force the "today" used for windows with `?date=YYYY-MM-DD`.
 */

const MINT_ENDPOINT = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/niftipay-invoice`;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!;
const GRACE_DAYS = Number(process.env.FEE_CANCELLATION_GRACE_DAYS ?? "3");
const CRON_TOKEN = process.env.CRON_TOKEN || "";
/** Shared runner (invoked by both GET and POST) */
async function runGenerateInvoices(req: NextRequest) {
    // ── 1) Auth
  const url = new URL(req.url);
  const isCronHeader = req.headers.get("x-vercel-cron") === "1";
  const token = url.searchParams.get("token") || "";
  const isCronToken = CRON_TOKEN && token && token === CRON_TOKEN;
  if (!isCronHeader && !isCronToken) {
    // Fallback to internal secret for manual runs
    const authErr = requireInternalAuth(req);
    if (authErr) return authErr;
  }

  // 2) Choose "today" (supports ?date=YYYY-MM-DD for testing)
  const today = url.searchParams.get("date")
    ? new Date(url.searchParams.get("date")!)
    : new Date();
  const genDay = today.getUTCDate();

  console.log(
    `[generate-invoices] invoked for date=${today.toISOString() .slice(0, 10)} (day=${genDay}) isCronHeader=${isCronHeader} isCronToken=${isCronToken}, graceDays=${GRACE_DAYS}`
  );

  // 2a) Compute dueDate = today + 7 days
  const dueDateObj = new Date(today);
  dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 7);
  const due = dueDateObj.toISOString().slice(0, 10);

  // 3) Fetch all org-owners
  const owners = await db
    .selectFrom("member as m")
    .innerJoin("user as u", "u.id", "m.userId")
    .select(["m.userId as userId", "u.createdAt as createdAt"])
    .where("m.role", "=", "owner")
    .execute();

  console.log(`[generate-invoices] total owners fetched: ${owners.length}`);

  // 4) Only those whose signup day matches today’s and who signed up before today
  const eligible = owners.filter(({ createdAt }) => {
    const d = new Date(createdAt);
    return d.getUTCDate() === genDay && d < today;
  });
  console.log(
    `[generate-invoices] eligible owners (signup DOM === ${genDay}): ${
      eligible.length ? eligible.map((o) => o.userId).join(", ") : "<none>"
    }`
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

  // 5) Loop & invoice per owner
  for (const { userId } of eligible) {
    // Compute the last-month window relative to genDay
    const y = today.getUTCFullYear();
    const m = today.getUTCMonth();
    const start = new Date(Date.UTC(y, m - 1, genDay, 0, 0, 0));
    const end = new Date(Date.UTC(y, m, genDay - 1, 23, 59, 59));
    const ps = start.toISOString().slice(0, 10);
    const pe = end.toISOString().slice(0, 10);

    console.log(`— user ${userId}: window ${ps} → ${pe}, due ${due}`);

    // Skip if already invoiced
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

    /**
     * Predicate:
     * Include fees captured within the window where:
     *  - Order status is paid-like (paid/pending_payment/completed)
     *    OR
     *  - Order is cancelled/refunded BUT cancellation/refund happened AFTER
     *    the grace window from fee capture time (i.e., too late to dodge fees)
     */
    const whereQualifyingFees = (eb: any) => {
      const grace = sql`(f."capturedAt" + make_interval(days => ${GRACE_DAYS}))`;
      return eb.or([
        eb("o.status", "in", ["paid", "pending_payment", "completed"]),
        eb.and([
          eb("o.status", "in", ["cancelled", "refunded"]),
          eb.or([
            sql<boolean>`o."dateCancelled" IS NULL`,
            sql<boolean>`o."dateCancelled" > ${grace}`,
          ]),
        ]),
      ]);
    };

    // 6) Sum qualifying fees for the period
    const sumRow = await db
      .selectFrom("orderFees as f")
      .innerJoin("orders as o", "o.id", "f.orderId")
      .select(sql<number>`coalesce(sum(f."feeAmount"), 0)`.as("total"))
      .where("f.userId", "=", userId)
      .where("f.capturedAt", ">=", start)
      .where("f.capturedAt", "<=", end)
      .where(whereQualifyingFees)
      .executeTakeFirst();

    const total = Number(sumRow?.total ?? 0);
    console.log(`  → total qualifying fees for period: ${total}`);

    // 7) If total is 0, still create a $0 invoice if there was any qualifying fee activity
    let hasActivity = false;
    if (total <= 0) {
      const cntRow = await db
        .selectFrom("orderFees as f")
        .innerJoin("orders as o", "o.id", "f.orderId")
        .select(sql<number>`count(*)`.as("count"))
        .where("f.userId", "=", userId)
        .where("f.capturedAt", ">=", start)
        .where("f.capturedAt", "<=", end)
        .where(whereQualifyingFees)
        .executeTakeFirst();
      const feeCount = Number(cntRow?.count ?? 0);
      hasActivity = feeCount > 0;
      if (!hasActivity) {
        console.log("  → skipping, no qualifying fee activity in this window");
        continue;
      }
      console.log("  → zero-amount invoice will be created (qualifying activity present)");
    }

    // 8) Insert invoice header
    const inv = await db
      .insertInto("userInvoices")
      .values({
        id: crypto.randomUUID(),
        userId,
        periodStart: ps,
        periodEnd: pe,
        totalAmount: total,
        paidAmount: 0,
        status: total > 0 ? "pending" : "paid",
        dueDate: due,
        niftipayNetwork: "ETH",
        niftipayAsset: "USDT",
        niftipayOrderId: null,
        niftipayReference: null,
        niftipayAddress: null,
        niftipayQrUrl: null,
        createdAt: new Date(),
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

    // 9) Mint on-chain immediately for nonzero invoices
    if (Number(inv.totalAmount) > 0) {
      try {
        await fetch(MINT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": INTERNAL_SECRET,
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

    // 10) Attach qualifying fee line items
    const fees = await db
      .selectFrom("orderFees as f")
      .innerJoin("orders as o", "o.id", "f.orderId")
      .select(["f.id as orderFeeId", "f.feeAmount as amount"])
      .where("f.userId", "=", userId)
      .where("f.capturedAt", ">=", start)
      .where("f.capturedAt", "<=", end)
      .where(whereQualifyingFees)
      .execute();

    console.log(`  → attaching ${fees.length} fee items`);
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
      periodEnd: inv.periodEnd,
      totalAmount: inv.totalAmount.toString(),
      dueDate: inv.dueDate,
      createdAt: (inv.createdAt as Date).toISOString(),
    });
  }

  console.log(`[generate-invoices] done, created ${created.length} invoices`);
  return NextResponse.json({ invoices: created });
}

/** Idempotent GET for hosted schedulers (e.g., Vercel Cron). */
export async function GET(req: NextRequest) {
  return runGenerateInvoices(req);
}

/** Manual/internal trigger with secret preserved. */
export async function POST(req: NextRequest) {
  return runGenerateInvoices(req);
}
