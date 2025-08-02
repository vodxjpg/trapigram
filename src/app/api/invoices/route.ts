// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sql } from "kysely";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

export async function GET(req: NextRequest) {
  // 1) auth
  const err = requireInternalAuth(req);
  if (err) return err;

  const url   = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const page    = parseInt(url.searchParams.get("page") ?? "1", 10);
  const limit   = parseInt(url.searchParams.get("limit") ?? "10", 10);
  const offset  = (page - 1) * limit;

  // 2) total count
  const cnt = await db
    .selectFrom("userInvoices")
    .select(sql<number>`count(*)`.as("count"))
    .executeTakeFirstOrThrow();
  const total = Number(cnt.count);
  const pages = Math.ceil(total / limit);

  // 3) fetch page
  let q = db
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
    ]);
  if (userId) {
    q = q.where("userId", "=", userId);
  }

  const items = await q
    .orderBy("periodStart", "desc")
    .limit(limit)
    .offset(offset)
    .execute();

  return NextResponse.json({
    items,
    meta: { total, pages, page, limit },
  });
}
