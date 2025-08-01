// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

export async function GET(req: NextRequest) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const periodStart = url.searchParams.get("periodStart");
  const periodEnd = url.searchParams.get("periodEnd");

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  let query = db
    .selectFrom('"userInvoices"')
    .select([
      '"id"',
      '"userId"',
      '"periodStart"',
      '"periodEnd"',
      '"totalAmount"',
      '"status"',
      '"dueDate"',
      '"createdAt"',
    ])
    .where('"userId"', "=", userId);

  if (periodStart) {
    query = query.where('"periodStart"', ">=", new Date(periodStart));
  }
  if (periodEnd) {
    query = query.where('"periodEnd"', "<=", new Date(periodEnd));
  }

  const items = await query.orderBy('"periodStart"', "desc").execute();
  return NextResponse.json({ items });
}
