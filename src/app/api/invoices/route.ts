// src/app/api/invoices/route.ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { requireInternalAuth } from "@/lib/internalAuth"

export async function GET(req: NextRequest) {
  const authErr = requireInternalAuth(req)
  if (authErr) return authErr

  const url = new URL(req.url)
  const userId = url.searchParams.get("userId")
  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  // page & limit for pagination
  const page = parseInt(url.searchParams.get("page") || "1", 10)
  const limit = parseInt(url.searchParams.get("limit") || "10", 10)
  const offset = (page - 1) * limit

  // get total count
  const [{ count }] = await db
    .selectFrom("userInvoices")
    .select(db.fn.count<string>("id").as("count"))
    .where("userId", "=", userId)
    .execute()

  // fetch page
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

  return NextResponse.json({
    items,
    meta: {
      total: Number(count),
      page,
      limit,
      pages: Math.ceil(Number(count) / limit),
    },
  })
}
