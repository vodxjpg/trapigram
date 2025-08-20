// src/app/api/internal/order-fees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

const dbg = (...a: any[]) => console.log("[orderFees]", ...a);
if (!process.env.INTERNAL_API_SECRET) {
  console.warn("[orderFees] ⚠️  INTERNAL_API_SECRET is not set – internal secret auth will be unavailable.");
}

export async function POST(req: NextRequest) {
  // 1) Auth (now supports x-internal-secret OR service-to-service mode)
  const authErr = requireInternalAuth(req);
  if (authErr) return authErr;

  // 2) Parse + validate body
  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    dbg("bad-request: invalid JSON body");
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { orderId } = body;
  if (!orderId) {
    dbg("bad-request: missing orderId");
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // 3) Fetch order (org, total, status, datePaid for capturedAt)
  const order = await db
    .selectFrom("orders")
    .select(["organizationId", "totalAmount", "status", "datePaid"])
    .where("id", "=", orderId)
    .executeTakeFirst();

  if (!order) {
    dbg("not-found: order", { orderId });
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  dbg("order", {
    orderId,
    orgId: order.organizationId,
    status: order.status,
    totalAmount: String(order.totalAmount),
  });

  // 3a) Idempotency – if a fee record already exists for this order, exit
  const existing = await db
    .selectFrom("orderFees")
    .select(["id", "feeAmount", "percentApplied"])
    .where("orderId", "=", orderId)
    .executeTakeFirst();

  if (existing) {
    dbg("duplicate-skip: fee already exists", {
      orderId,
      feeId: existing.id,
      feeAmount: String(existing.feeAmount),
      percentApplied: String(existing.percentApplied),
    });
    return NextResponse.json(
      { skipped: true, reason: "fee already exists", feeId: existing.id },
      { status: 200 }
    );
  }

  // 4) Find organization owner
  const owner = await db
    .selectFrom("member")
    .select("userId")
    .where("organizationId", "=", order.organizationId)
    .where("role", "=", "owner")
    .executeTakeFirst();

  if (!owner) {
    dbg("not-found: org owner", { orgId: order.organizationId });
    return NextResponse.json(
      { error: "Organization owner not found" },
      { status: 404 }
    );
  }
  dbg("owner", { userId: owner.userId });

  // 5) Load owner fee rates and pick the active one
  const now = new Date();
  const allRates = await db
    .selectFrom("userFeeRates")
    .select(["percent", "startsAt", "endsAt"])
    .where("userId", "=", owner.userId)
    .orderBy("startsAt", "desc")
    .execute();

  dbg("rates", { count: allRates.length });

  const active = allRates.find((r) => {
    const start = new Date(r.startsAt);
    const end = r.endsAt ? new Date(r.endsAt) : null;
    return start <= now && (!end || end > now);
  });

  if (!active) {
    dbg("no-active-rate", { userId: owner.userId, at: now.toISOString() });
    return NextResponse.json(
      { error: "No fee rate defined for user" },
      { status: 404 }
    );
  }

  dbg("active-rate", {
    percent: String(active.percent),
    startsAt: new Date(active.startsAt).toISOString(),
    endsAt: active.endsAt ? new Date(active.endsAt).toISOString() : null,
  });

  // 6) Calculate fee
  const pct = Number(active.percent);
  const orderTotal = Number(order.totalAmount);
  if (!isFinite(pct)) {
    dbg("invalid-rate-percent", { percent: active.percent });
    return NextResponse.json(
      { error: "Invalid fee rate percent for user" },
      { status: 400 }
    );
  }
  if (!isFinite(orderTotal)) {
    dbg("invalid-order-total", { totalAmount: order.totalAmount });
    return NextResponse.json({ error: "Invalid order total" }, { status: 400 });
  }

  const fee = (pct / 100) * orderTotal;
  dbg("calc", { pct, orderTotal, fee });

  // 7) Determine capturedAt – align to order.datePaid if present
  const capturedAt =
    order?.datePaid ? new Date(order.datePaid as any) : new Date();
  dbg("capturedAt", {
    capturedAt: capturedAt.toISOString(),
    hasDatePaid: Boolean(order?.datePaid),
  });

  // 8) Insert fee row
  const id = crypto.randomUUID();
  try {
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

    dbg("inserted", inserted);
    return NextResponse.json({ item: inserted! }, { status: 201 });
  } catch (e: any) {
    dbg("insert-failed", { error: e?.message ?? String(e) });
    return NextResponse.json(
      { error: "Failed to insert fee record" },
      { status: 500 }
    );
  }
}
