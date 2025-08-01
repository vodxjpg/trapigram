// src/app/api/fee-rates/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

/** GET all fee rates */
export async function GET(req: NextRequest) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const rates = await db
    .selectFrom('"userFeeRates"')
    .select(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .orderBy('"startsAt"', 'desc')
    .execute();

  return NextResponse.json({ items: rates });
}

/** POST a new fee rate */
export async function POST(req: NextRequest) {
  const err = requireInternalAuth(req);
  if (err) return err;

  let body: { userId?: string; percent?: number; startsAt?: string; endsAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, percent, startsAt, endsAt } = body;
  if (!userId || typeof percent !== "number" || percent < 0) {
    return NextResponse.json(
      { error: "userId (string) and percent (non-negative number) required" },
      { status: 400 }
    );
  }

  const inserted = await db
    .insertInto('"userFeeRates"')
    .values({
      "userId": userId,
      "percent": percent,
      "startsAt": startsAt ? new Date(startsAt) : undefined,
      "endsAt": endsAt ? new Date(endsAt) : undefined,
    })
    .returning(['"id"', '"userId"', '"percent"', '"startsAt"', '"endsAt"', '"createdAt"'])
    .executeTakeFirst();

  return NextResponse.json({ item: inserted }, { status: 201 });
}
