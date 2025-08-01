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

  // 4) Decide new status
  let newStatus = inv.status;
  if (evt === "paid")        newStatus = "paid";
  else if (evt === "underpaid") newStatus = "underpaid";
  else if (evt === "expired")   newStatus = "cancelled";

  console.log(`[niftipay] current status='${inv.status}', newStatus='${newStatus}'`);

  // 5) Only update if it actually changed
  if (newStatus !== inv.status) {
    await db
      .updateTable("userInvoices")
      .set({ status: newStatus })
      .where("id", "=", ref)
      .execute();
    console.log(`[niftipay] invoice ${ref} status updated to '${newStatus}'`);
  } else {
    console.log("[niftipay] status unchanged, no update");
  }

  // 6) Return 200 so Niftipay knows we handled it
  return NextResponse.json({ ok: true }, { status: 200 });
}
