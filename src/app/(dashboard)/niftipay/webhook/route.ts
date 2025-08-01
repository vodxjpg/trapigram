// src/app/niftipay/webhook/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(req: NextRequest) {
  let payload: any
  try {
    payload = await req.json()
  } catch {
    // nothing to do if malformed
    return NextResponse.json({}, { status: 200 })
  }

  const evt       = String(payload.event || '').toLowerCase()
  const reference = payload.order?.reference
  if (!reference) {
    return NextResponse.json({}, { status: 200 })
  }

  // fetch our invoice (we used invoice.id as the reference)
  const inv = await db
    .selectFrom('userInvoices')
    .select(['id', 'status'])
    .where('id', '=', reference)
    .executeTakeFirst()

  if (!inv) {
    // unknown invoice → ignore
    return NextResponse.json({}, { status: 200 })
  }

  // map Niftipay event → our invoice.status
  let newStatus = inv.status
  if (evt === 'paid')       newStatus = 'paid'
  else if (evt === 'underpaid') newStatus = 'underpaid'
  else if (evt === 'expired')   newStatus = 'cancelled'
  else {
    // other events we don’t care about
    return NextResponse.json({}, { status: 200 })
  }

  // only write if it’s changed
  if (newStatus !== inv.status) {
    await db
      .updateTable('userInvoices')
      .set({ status: newStatus })
      .where('id', '=', inv.id)
      .execute()
  }

  return NextResponse.json({}, { status: 200 })
}
