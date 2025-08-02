// src/app/api/invoices/[invoiceId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

type Params = { params: { invoiceId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  // 1) auth
  const err = requireInternalAuth(req);
  if (err) return err;

  // 2) invoice header
  const invoice = await db
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
    .where("id", "=", params.invoiceId)
    .executeTakeFirst();

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3) line items
  const items = await db
    .selectFrom("invoiceItems as ii")
    .innerJoin("orderFees as of", "of.id", "ii.orderFeeId")
    .select([
      "ii.id as itemId",
      "ii.amount",
      "of.orderId",
      "of.feeAmount",
      "of.percentApplied",
    ])
    .where("ii.invoiceId", "=", params.invoiceId)
    .execute();

  return NextResponse.json({ invoice, items });
}
