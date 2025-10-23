// src/app/api/fee-rates/[rateId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

// Next 15/16: params is a Promise
type Ctx = { params: Promise<{ rateId: string }> };

/** GET one fee rate */
export async function GET(req: NextRequest, ctx: Ctx) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const { rateId } = await ctx.params;

  const rate = await db
    .selectFrom('"userFeeRates"')
    .select(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .where('"id"', "=", rateId)
    .executeTakeFirst();

  if (!rate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ item: rate }, { status: 200 });
}

/** PATCH (update) a fee rate */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const { rateId } = await ctx.params;

  let body: { percent?: number; startsAt?: string; endsAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};

  if (body.percent !== undefined) {
    if (typeof body.percent !== "number" || !Number.isFinite(body.percent) || body.percent < 0) {
      return NextResponse.json({ error: "percent must be a non-negative number" }, { status: 400 });
    }
    updates["percent"] = body.percent;
  }

  if (body.startsAt !== undefined) {
    const d = new Date(body.startsAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "startsAt must be a valid date string" }, { status: 400 });
    }
    updates["startsAt"] = d;
  }

  if (body.endsAt !== undefined) {
    const d = new Date(body.endsAt);
    if (Number.isNaN(d.getTime())) {
      return NextResponse.json({ error: "endsAt must be a valid date string" }, { status: 400 });
    }
    updates["endsAt"] = d;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db
    .updateTable('"userFeeRates"')
    .set(updates)
    .where('"id"', "=", rateId)
    .returning(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .executeTakeFirst();

  if (!updated) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ item: updated }, { status: 200 });
}

/** DELETE (soft-end) a fee rate */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const { rateId } = await ctx.params;

  const now = new Date();
  const result = await db
    .updateTable('"userFeeRates"')
    .set({ endsAt: now })
    .where('"id"', "=", rateId)
    .returning(['"id"'])
    .executeTakeFirst();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true }, { status: 200 });
}
