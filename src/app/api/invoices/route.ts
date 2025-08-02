// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server"
import { sql } from "kysely"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context"

export async function GET(req: NextRequest) {
  // 1) auth + context
  const ctxOrRes = await getContext(req)
  if (ctxOrRes instanceof NextResponse) return ctxOrRes
  const { userId } = ctxOrRes

  // 2) parse pagination
  const url    = new URL(req.url)
  const page   = Math.max(1, parseInt(url.searchParams.get("page")  ?? "1",  10))
  const limit  = Math.max(1, parseInt(url.searchParams.get("limit") ?? "10", 10))
  const offset = (page - 1) * limit

  // 3) total count
  const [{ count }] = await db
    .selectFrom("userInvoices")
    .select(sql<number>`count(*)`.as("count"))
    .where("userId", "=", userId)
    .execute()

  const total = Number(count)
  const pages = Math.ceil(total / limit)

  // 4) fetch page
  const items = await db
    .selectFrom("userInvoices")
    .select([
      "id",
      "periodStart",
      "periodEnd",
      "totalAmount",
      "status",
      "dueDate",
      "createdAt",
    ])
    .where("userId", "=", userId)
    .orderBy("periodStart", "desc")
    .limit(limit)
    .offset(offset)
    .execute()

  return NextResponse.json({ items, meta: { total, pages, page, limit } })
}
