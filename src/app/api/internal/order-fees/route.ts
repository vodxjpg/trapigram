// src/app/api/internal/order-fees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

export async function POST(req: NextRequest) {
  const err = requireInternalAuth(req);
  if (err) return err;

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = body.orderId;
  if (!orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  // 1. Fetch order and ensure it's paid
  const order = await db
    .selectFrom("orders")
    .select(["id", "totalAmount", "organizationId", "datePaid"])
    .where("id", "=", orderId)
    .executeTakeFirst();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (!order.datePaid) {
    return NextResponse.json({ error: "Order not paid" }, { status: 400 });
  }

  // 2. Resolve tenant-owner userId
  const org = await db
    .selectFrom("organization")
    .select("metadata")
    .where("id", "=", order.organizationId)
    .executeTakeFirst();
  if (!org) {
    return NextResponse.json({ error: "Organization not found" }, { status: 404 });
  }

  let tenantId: string | undefined;
  if (org.metadata) {
    try {
      const meta = typeof org.metadata === "string" ? JSON.parse(org.metadata) : org.metadata;
      tenantId = meta?.tenantId;
    } catch {}
  }
  if (!tenantId) {
    return NextResponse.json({ error: "Tenant not found in metadata" }, { status: 400 });
  }

  const tenant = await db
    .selectFrom("tenant")
    .select("ownerUserId")
    .where("id", "=", tenantId)
    .executeTakeFirst();
  if (!tenant?.ownerUserId) {
    return NextResponse.json({ error: "Tenant owner not found" }, { status: 404 });
  }
  const userId = tenant.ownerUserId;

  // 3. Look up active fee rate
  const now = new Date();
  const rate = await db
    .selectFrom('"userFeeRates"')
    .select(['"percent"'])
    .where('"userId"', "=", userId)
    .where('"startsAt"', "<=", now)
    .where((qb) =>
      qb.where('"endsAt"', ">", now).orWhere('"endsAt"', "is", null)
    )
    .orderBy('"startsAt"', "desc")
    .executeTakeFirst();

  if (!rate) {
    return NextResponse.json({ error: "No active fee rate for user" }, { status: 400 });
  }

  // 4. Compute and record fee
  const percent = Number(rate.percent);
  const feeAmount = Number(order.totalAmount) * (percent / 100);

  const inserted = await db
    .insertInto('"orderFees"')
    .values({
      orderId,
      userId,
      feeAmount,
      percentApplied: percent,
    })
    .returning(['"id"', '"orderId"', '"userId"', '"feeAmount"', '"percentApplied"', '"capturedAt"'])
    .executeTakeFirst();

  return NextResponse.json({ item: inserted }, { status: 201 });
}
