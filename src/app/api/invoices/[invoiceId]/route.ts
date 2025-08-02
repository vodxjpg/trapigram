// src/app/api/invoices/[invoiceId]/route.ts
import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getContext } from "@/lib/context"

type Params = { params: { invoiceId: string } }

export async function GET(req: NextRequest, { params }: Params) {
  // 1) auth + context
  const ctxOrRes = await getContext(req)
  if (ctxOrRes instanceof NextResponse) return ctxOrRes
  const { userId } = ctxOrRes

  // 2) fetch invoice header, ensure owner
  const invoice = await db
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
    .where("id", "=", params.invoiceId)
    .where("userId", "=", userId)
    .executeTakeFirst()

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  // 3) fetch line items
  const items = await db
    .selectFrom("invoiceItems as ii")
    .innerJoin("orderFees as of", "of.id", "ii.orderFeeId")
    .select([
      "ii.id as itemId",
      "ii.amount as amount",
      "of.orderId as orderId",
      "of.feeAmount as feeAmount",
      "of.percentApplied as percentApplied",
    ])
    .where("ii.invoiceId", "=", params.invoiceId)
    .execute()

  return NextResponse.json({ invoice, items })
}
