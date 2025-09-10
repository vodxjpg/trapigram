// src/app/api/niftipay/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(req: NextRequest) {
  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({}, { status: 200 });
  }

  const evt = (payload.event || "").toLowerCase();
  const ref = payload.order?.reference;
  if (!ref) return NextResponse.json({}, { status: 200 });

  // lookup our invoice by its ID
  const inv = await db
    .selectFrom("userInvoices")
    .select(["id", "status"])
    .where("id", "=", ref)
    .executeTakeFirst();

  if (!inv) return NextResponse.json({}, { status: 200 });

  let newStatus = inv.status;
  if (evt === "paid") newStatus = "paid";
  else if (evt === "underpaid") newStatus = "underpaid";
  else if (evt === "expired") newStatus = "cancelled";

  if (newStatus !== inv.status) {
    await db
      .updateTable("userInvoices")
      .set({ status: newStatus })
      .where("id", "=", ref)
      .execute();
  }

  return NextResponse.json({}, { status: 200 });
}
