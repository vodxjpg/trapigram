// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function GET(req: NextRequest) {
  // 1) Auth & context
  const ctxOrRes = await getContext(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const { userId } = ctxOrRes;

  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const offset = (page - 1) * limit;

  // 2) total count for this user
  const cnt = await db
    .selectFrom("userInvoices")
    .select(sql<number>`count(*)`.as("count"))
    .where("userId", "=", userId)
    .executeTakeFirstOrThrow();

  const total = Number(cnt.count);
  const pages = Math.ceil(total / limit);

  // 3) fetch page
  const items = await db
    .selectFrom("userInvoices")
    .select([
      "id",
      "userId",
      "periodStart",
      "periodEnd",
      "totalAmount",
      "paidAmount",
      "status",
      "dueDate",
      "createdAt",
      "niftipayAddress as depositAddress",
    ])
    .where("userId", "=", userId)
    .orderBy("periodStart", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return NextResponse.json({
    items,
    meta: { total, pages, page, limit },
  });
}
