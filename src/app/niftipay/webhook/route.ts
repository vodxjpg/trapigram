// src/app/niftipay/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({}, { status: 200 });
  }

  const evt       = (payload.event || "").toLowerCase();
  const reference = payload.order?.reference;
  if (!reference) return NextResponse.json({}, { status: 200 });

  // lookup our invoice by its ID (we used invoice.id as reference)
  const inv = await db
    .selectFrom('"userInvoices"')
    .select(['"id"', '"status"'])
    .where('"id"', "=", reference)
    .executeTakeFirst();

  if (!inv) return NextResponse.json({}, { status: 200 });

  // map to our statuses
  let newStatus = inv.status;
  if (evt === "paid")       newStatus = "paid";
  else if (evt === "underpaid") newStatus = "underpaid";
  else if (evt === "expired")   newStatus = "cancelled";

  if (newStatus !== inv.status) {
    await db
      .updateTable('"userInvoices"')
      .set({ status: newStatus })
      .where('"id"', "=", inv.id)
      .execute();
  }

  return NextResponse.json({}, { status: 200 });
}
