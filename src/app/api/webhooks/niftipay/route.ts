// src/app/api/webhooks/niftipay/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// (Optionally verify signature header here)

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({}, { status: 200 });
  }

  const evt      = String(body.event || "").toLowerCase();
  const reference = body.order?.reference as string | undefined;
  if (!reference) {
    return NextResponse.json({}, { status: 200 });
  }

  // Find our invoice by reference
  const inv = await db
    .selectFrom('"userInvoices"')
    .select(['"id"', '"status"'])
    .where('"id"', "=", reference)
    .executeTakeFirst();

  if (!inv) {
    return NextResponse.json({}, { status: 200 });
  }

  // Map Niftipay events → our statuses
  let newStatus: string = inv.status;
  if (evt === "paid") newStatus = "paid";
  else if (evt === "underpaid") newStatus = "underpaid";
  else if (evt === "expired") newStatus = "cancelled";

  if (newStatus !== inv.status) {
    await db
      .updateTable('"userInvoices"')
      .set({ status: newStatus })
      .where('"id"', "=", inv.id)
      .execute();
  }

  return NextResponse.json({}, { status: 200 });
}
