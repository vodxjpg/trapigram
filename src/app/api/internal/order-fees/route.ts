// src/app/api/internal/order-fees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  // 1) auth
  const err = requireInternalAuth(req);
  if (err) return err;

  // 2) parse + validate body
  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { orderId } = body;
  if (!orderId) {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // 3) fetch order
  const order = await db
    .selectFrom("orders")
    .select(["organizationId", "totalAmount"])
    .where("id", "=", orderId)
    .executeTakeFirst();
  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // 4) find organization owner
  const owner = await db
    .selectFrom("member")
    .select("userId")
    .where("organizationId", "=", order.organizationId)
    .where("role", "=", "owner")
    .executeTakeFirst();
  if (!owner) {
    return NextResponse.json({ error: "Organization owner not found" }, { status: 404 });
  }

  // 5) load current fee rate
  const now = new Date();
  const rate = await db
    .selectFrom("userFeeRates")
    .select("percent")
    .where("userId", "=", owner.userId)
    .where("startsAt", "<=", now)
    // group endsAt condition via raw SQL to avoid builder bug
    .whereRaw("(\"endsAt\" > ? OR \"endsAt\" IS NULL)", [now])
    .orderBy("startsAt", "desc")
    .executeTakeFirst();
  if (!rate) {
    return NextResponse.json({ error: "No fee rate defined for user" }, { status: 404 });
  }

  // 6) calculate fee
  const pct = parseFloat(rate.percent);
  const fee = (pct / 100) * Number(order.totalAmount);

  // 7) record fee
  const id = crypto.randomUUID();
  const capturedAt = new Date();
  const inserted = await db
    .insertInto("orderFees")
    .values({
      id,
      orderId,
      userId: owner.userId,
      percentApplied: pct.toString(),
      feeAmount: fee.toString(),
      capturedAt,
    })
    .returning([
      "id",
      "orderId",
      "userId",
      "percentApplied",
      "feeAmount",
      "capturedAt",
    ])
    .executeTakeFirst();

  return NextResponse.json({ item: inserted! }, { status: 201 });
}
