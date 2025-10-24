// src/app/api/internal/generate-invoices/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";
import { sendEmail } from "@/lib/email";

/**
 * Endpoint purpose:
 * - Generates monthly invoices per user (org owners) on their signup day-of-month.
 * - Only includes fees from orders that are PAID-LIKE, or were canceled/refunded AFTER a grace window.
 * - Skips minting zero-amount invoices (but still creates them if there was activity).
 * - Emails the owner once the invoice is generated.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const MINT_ENDPOINT = `${APP_URL}/api/internal/niftipay-invoice`;
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!;
const GRACE_DAYS = Number(process.env.FEE_CANCELLATION_GRACE_DAYS ?? "3");

/** Use CRON_SECRET provided in Vercel env; Vercel Cron sends Authorization: Bearer <CRON_SECRET> */
const CRON_SECRET = process.env.CRON_SECRET || "";

/** Strict UTC parser for YYYY-MM-DD. Returns null on invalid input. */
function parseYMDToUTC(d?: string | null): Date | null {
  if (!d) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1, da = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, da, 0, 0, 0, 0));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Validate Vercel Cron (or curl) via Authorization: Bearer <CRON_SECRET> */
function isCronAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization") || "";
  return !!CRON_SECRET && auth === `Bearer ${CRON_SECRET}`;
}

/** Shared runner (invoked by both GET and POST) */
async function runGenerateInvoices(req: NextRequest) {
  // 1) Auth
  const url = new URL(req.url);
  const isCronHeader = req.headers.get("x-vercel-cron") === "1";
  const cronOk = isCronAuthorized(req);

  if (!cronOk) {
    // Fallback to your existing internal auth (cookie/header/etc.)
    const authErr = requireInternalAuth(req);
    if (authErr) return authErr;
  }

  // 2) Today (UTC; supports ?date=YYYY-MM-DD)
  const dateParam = url.searchParams.get("date");
  const parsed = parseYMDToUTC(dateParam);
  const today = parsed ?? new Date();
  const genDay = today.getUTCDate();

  console.log(
    `[generate-invoices] invoked for date=${new Date(today).toISOString().slice(0, 10)} (day=${genDay}) ` +
    `isCronHeader=${isCronHeader} cronAuthorized=${cronOk}, graceDays=${GRACE_DAYS}`
  );

  // 2a) dueDate = today + 7d (UTC)
  const dueDateObj = new Date(today);
  dueDateObj.setUTCDate(dueDateObj.getUTCDate() + 7);
  const due = dueDateObj.toISOString().slice(0, 10);

  // 3) All org owners
  const owners = await db
    .selectFrom("member as m")
    .innerJoin("user as u", "u.id", "m.userId")
    .select(["m.userId as userId", "u.createdAt as createdAt"])
    .where("m.role", "=", "owner")
    .execute();

  console.log(`[generate-invoices] total owners fetched: ${owners.length}`);

  type OwnerRow = { userId: string; createdAt: Date | null };

  // 4) Eligible owners (signup DOM matches today & signed up before today)
  const eligible = (owners as OwnerRow[]).filter(
    (o): o is { userId: string; createdAt: Date } => {
      if (!o.createdAt) return false;
      const d = new Date(o.createdAt);
      if (Number.isNaN(d.getTime())) return false;
      return d.getUTCDate() === genDay && d.getTime() < today.getTime();
    }
  );
  console.log(
    `[generate-invoices] eligible owners (signup DOM === ${genDay}): ${eligible.length ? eligible.map((o) => o.userId).join(", ") : "<none>"
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
    emailed: boolean;
  }> = [];

  // 5) Loop per eligible owner
  for (const { userId } of eligible) {
    // Window: previous month anchored to genDay
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
     * Qualifying fees:
     *  - Order status is paid-like (paid/pending_payment/completed), OR
     *  - Order is cancelled/refunded BUT the cancellation/refund happened AFTER
     *    the grace window from fee capture.
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

    // 6) Sum qualifying fees
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

    // 7) If total is 0, still create $0 invoice if there was activity
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

    // 11) Email the owner about the invoice (non-blocking if fails)
    let emailed = false;
    try {
      const u = await db
        .selectFrom("user")
        .select(["email", "name"])
        .where("id", "=", userId)
        .executeTakeFirst();

      const to = u?.email || "";
      if (to) {
        const amount = Number(inv.totalAmount || 0).toFixed(2);
        const link = APP_URL ? `${APP_URL}/invoices/${inv.id}` : `/invoices/${inv.id}`;

        const subject = `Your monthly invoice — ${inv.periodStart} → ${inv.periodEnd}`;
        const html = `
          <p>Hi ${[u?.name].filter(Boolean).join(" ") || "there"},</p>
          <p>Your monthly platform invoice has been generated.</p>
          <ul>
            <li><strong>Period:</strong> ${inv.periodStart} → ${inv.periodEnd}</li>
            <li><strong>Total:</strong> $${amount}</li>
            <li><strong>Due date:</strong> ${inv.dueDate}</li>
            <li><strong>Status:</strong> ${inv.status}</li>
          </ul>
          <p><a href="${link}">View invoice</a></p>
          <p>If you have questions, just reply to this email.</p>
        `.trim();

        const text = [
          `Your monthly platform invoice has been generated.`,
          `Period: ${inv.periodStart} → ${inv.periodEnd}`,
          `Total: $${amount}`,
          `Due date: ${inv.dueDate}`,
          `Status: ${inv.status}`,
          `View: ${link}`,
        ].join("\n");

        await sendEmail({ to, subject, html, text });
        emailed = true;
        console.log(`  → emailed invoice ${inv.id} to ${to}`);
      } else {
        console.warn(`  → no email for user ${userId}; skipping email for invoice ${inv.id}`);
      }
    } catch (e) {
      console.warn(`  → email send failed for invoice ${inv.id}`, e);
    }

    created.push({
      id: inv.id,
      userId: inv.userId,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      totalAmount: inv.totalAmount.toString(),
      dueDate: inv.dueDate,
      createdAt: new Date(inv.createdAt as Date).toISOString(),
      emailed,
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
