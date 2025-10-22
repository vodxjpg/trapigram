// src/app/api/invoices/[invoiceId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";

/** Next 15+ may pass params as a Promise */
type Ctx = { params: Promise<{ invoiceId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  // 1) Auth & context
  const auth = await getContext(req);
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { invoiceId } = await ctx.params;

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
