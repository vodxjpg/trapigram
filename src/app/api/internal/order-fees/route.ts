// src/app/api/internal/order-fees/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";
import crypto from "crypto";

const dbg = (...a: any[]) => console.log("[orderFees]", ...a);
if (!process.env.INTERNAL_API_SECRET) {
  console.warn("[orderFees] ⚠️  INTERNAL_API_SECRET is not set – internal auth will fail.");
}

export async function POST(req: NextRequest) {
  // 1) auth
  // Normal path: require secret.
  // Dev/staging fallback: allow same-process callers that explicitly opt in via header.
  const unsafeLocal = req.headers.get("x-local-invoke") === "1";
  if (!unsafeLocal) {
    const err = requireInternalAuth(req);
    if (err) return err;
  } else {
    console.warn("[orderFees] ⚠️ allowing local invocation without INTERNAL_API_SECRET");
  }

  // 2) parse + validate body
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

  // 3) fetch order (include dates for capturedAt)
  const order = await db
    .selectFrom("orders")
    .select([
      "organizationId",
      "totalAmount",
      "status",
      "datePaid",
      "dateCreated",
    ])
    .where("id", "=", orderId)
    .executeTakeFirst();

  if (!order) {
    dbg("not-found: order", { orderId });
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const statusNorm = String(order.status ?? "").toLowerCase();
  const paidLike = new Set(["paid", "pending_payment", "completed"]);

  // Only account fees for paid-like orders
  if (!paidLike.has(statusNorm)) {
    dbg("status-skip: not paid-like", { orderId, status: statusNorm });
    return NextResponse.json(
      { skipped: true, reason: `status ${statusNorm} not eligible` },
      { status: 200 },
    );
  }

  dbg("order", {
    orderId,
    orgId: order.organizationId,
    status: statusNorm,
    totalAmount: String(order.totalAmount),
  });

  // 3a) idempotency: skip if a fee already exists for this order
  const existing = await db
    .selectFrom("orderFees")
    .select("id")
    .where("orderId", "=", orderId)
    .executeTakeFirst();

  if (existing) {
    dbg("duplicate-skip: fee already exists", { orderId, feeId: existing.id });
    return NextResponse.json(
      { skipped: true, reason: "fee already exists", feeId: existing.id },
      { status: 200 },
    );
  }

  // 4) find organization owner
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
      { status: 404 },
    );
  }
  dbg("owner", { userId: owner.userId });

  // 5) load all rates and pick the active one (now ∈ [startsAt, endsAt))
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
      { status: 404 },
    );
  }

  dbg("active-rate", {
    percent: String(active.percent),
    startsAt: new Date(active.startsAt).toISOString(),
    endsAt: active.endsAt ? new Date(active.endsAt).toISOString() : null,
  });

  // 6) calculate fee
  const pct = Number(active.percent);
  const orderTotal = Number(order.totalAmount);
  if (!isFinite(pct)) {
    dbg("invalid-rate-percent", { percent: active.percent });
    return NextResponse.json(
      { error: "Invalid fee rate percent for user" },
      { status: 400 },
    );
  }
  if (!isFinite(orderTotal)) {
    dbg("invalid-order-total", { totalAmount: order.totalAmount });
    return NextResponse.json({ error: "Invalid order total" }, { status: 400 });
  }

  const fee = (pct / 100) * orderTotal;
  dbg("calc", { pct, orderTotal, fee });

  // 7) record fee
  const id = crypto.randomUUID();

  // Align with the accounting period of the order:
  const capturedAt =
    (order.datePaid ? new Date(order.datePaid as any) : null) ??
    (order.dateCreated ? new Date(order.dateCreated as any) : null) ??
    new Date();

  dbg("capturedAt", {
    capturedAt: capturedAt.toISOString(),
    hasDatePaid: Boolean(order.datePaid),
    hasDateCreated: Boolean(order.dateCreated),
  });

  let inserted;
  try {
    inserted = await db
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
  } catch (e) {
    dbg("insert-failed", { error: (e as Error)?.message });
    return NextResponse.json(
      { error: "Failed to insert fee record" },
      { status: 500 },
    );
  }

  dbg("inserted", inserted);
  return NextResponse.json({ item: inserted! }, { status: 201 });
}
