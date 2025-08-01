// src/app/api/fee-rates/[rateId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

type Params = { params: { rateId: string } };

/** GET one fee rate */
export async function GET(req: NextRequest, { params }: Params) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const rate = await db
    .selectFrom('"userFeeRates"')
    .select(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .where('"id"', "=", params.rateId)
    .executeTakeFirst();

  if (!rate) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ item: rate });
}

/** PATCH (update) a fee rate */
export async function PATCH(req: NextRequest, { params }: Params) {
  const err = requireInternalAuth(req);
  if (err) return err;

  let body: { percent?: number; startsAt?: string; endsAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (body.percent !== undefined) {
    if (typeof body.percent !== "number" || body.percent < 0) {
      return NextResponse.json({ error: "percent must be a non-negative number" }, { status: 400 });
    }
    updates['percent'] = body.percent;
  }
  if (body.startsAt) updates['startsAt'] = new Date(body.startsAt);
  if (body.endsAt) updates['endsAt'] = new Date(body.endsAt);

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const updated = await db
    .updateTable('"userFeeRates"')
    .set(updates)
    .where('"id"', "=", params.rateId)
    .returning(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .executeTakeFirst();

  return NextResponse.json({ item: updated });
}

/** DELETE (soft-end) a fee rate */
export async function DELETE(req: NextRequest, { params }: Params) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const now = new Date();
  const result = await db
    .updateTable('"userFeeRates"')
    .set({ endsAt: now })
    .where('"id"', "=", params.rateId)
    .returning(['"id"'])
    .executeTakeFirst();

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ success: true });
}
