// src/app/api/niftipay/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  // 1) Try to parse JSON
  let payload: any;
  try {
    payload = await req.json();
    console.log("[niftipay] payload:", payload);
  } catch (err) {
    console.log("[niftipay] failed to parse JSON:", err);
    return NextResponse.json({}, { status: 200 });
  }

  // 2) Normalize event & reference
  const evt = (payload.event || "").toLowerCase();
  const ref = payload.order?.reference;
  console.log(`[niftipay] event='${evt}', reference='${ref}'`);
  if (!ref) {
    console.log("[niftipay] no reference in payload, ignoring");
    return NextResponse.json({}, { status: 200 });
  }

  // 3) Look up our invoice
  const inv = await db
    .selectFrom("userInvoices")
    .select(["id", "status"])
    .where("id", "=", ref)
    .executeTakeFirst();

  console.log("[niftipay] invoice lookup result:", inv);
  if (!inv) {
    console.log(`[niftipay] no invoice found with id=${ref}, ignoring`);
    return NextResponse.json({}, { status: 200 });
  }

  // 4) Decide new status & paidAmount
  let newStatus = inv.status;
  let newPaidAmount: number | undefined;

  if (evt === "paid") {
    newStatus = "paid";
    // when fully paid, Niftipay reports `order.amount`
    newPaidAmount = Number(payload.order.amount);
  } else if (evt === "underpaid") {
    newStatus = "underpaid";
    // on underpaid, Niftipay includes payload.order.received
    newPaidAmount = Number(payload.order.received);
  } else if (evt === "expired") {
    newStatus = "cancelled";
    // no amount to set on expiry
  }

  console.log(
    `[niftipay] current status='${inv.status}', newStatus='${newStatus}', newPaidAmount=${newPaidAmount}`
  );

  // 5) Only update if something actually changed
  if (newStatus !== inv.status || newPaidAmount !== undefined) {
    const update: Record<string, unknown> = { status: newStatus };
    if (newPaidAmount !== undefined) {
      update.paidAmount = newPaidAmount;
    }

    await db
      .updateTable("userInvoices")
      .set(update)
      .where("id", "=", ref)
      .execute();

    console.log(
      `[niftipay] invoice ${ref} updated → status='${newStatus}'${
        newPaidAmount !== undefined
          ? `, paidAmount=${newPaidAmount}`
          : ""
      }`
    );
  } else {
    console.log("[niftipay] nothing to update");
  }

  // 6) Return 200 so Niftipay knows we handled it
  return NextResponse.json({ ok: true }, { status: 200 });
}
