// src/app/api/invoices/[invoiceId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

type Params = { params: { invoiceId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  // 1) Auth & context
  const ctxOrRes = await getContext(req);
  if (ctxOrRes instanceof NextResponse) return ctxOrRes;
  const { userId } = ctxOrRes;

  const { invoiceId } = params;

  // 2) invoice header (only if it belongs to this user)
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
    .where("id", "=", invoiceId)
    .where("userId", "=", userId)
    .executeTakeFirst();

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // 3) line items (join orders to get orderKey)
  const items = await db
    .selectFrom("invoiceItems as ii")
    .innerJoin("orderFees as of", "of.id", "ii.orderFeeId")
    .innerJoin("orders as o", "o.id", "of.orderId")
    .select([
      "ii.id as itemId",
      "ii.amount",
      "of.feeAmount",
      "of.percentApplied",
      "o.orderKey as orderKey",
    ])
    .where("ii.invoiceId", "=", invoiceId)
    .execute();

  return NextResponse.json({ invoice, items });
}
