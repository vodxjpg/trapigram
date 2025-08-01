// src/app/api/invoices/[invoiceId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

type Params = { params: { invoiceId: string } };

export async function GET(req: NextRequest, { params }: Params) {
  const err = requireInternalAuth(req);
  if (err) return err;

  const invoice = await db
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
    .where('"id"', "=", params.invoiceId)
    .executeTakeFirst();

  if (!invoice) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const items = await db
    .selectFrom('"invoiceItems" as ii')
    .innerJoin('"orderFees" as of', 'of.id', 'ii."orderFeeId"')
    .select([
      'ii."id" as itemId',
      'ii."amount" as amount',
      'of."orderId" as orderId',
      'of."feeAmount" as feeAmount',
      'of."percentApplied" as percentApplied',
    ])
    .where('ii."invoiceId"', "=", params.invoiceId)
    .execute();

  return NextResponse.json({ invoice, items });
}
