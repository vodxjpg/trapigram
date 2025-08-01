// src/app/api/internal/niftipay-invoice/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

const NIFTIPAY_API_URL    = process.env.NIFTIPAY_API_URL;
const NIFTIPAY_API_KEY    = process.env.NIFTIPAY_API_KEY;
const NIFTIPAY_MERCHANT_ID = process.env.NIFTIPAY_MERCHANT_ID;

if (!NIFTIPAY_API_URL || !NIFTIPAY_API_KEY || !NIFTIPAY_MERCHANT_ID) {
  throw new Error(
    "Missing NIFTIPAY_API_URL, NIFTIPAY_API_KEY or NIFTIPAY_MERCHANT_ID"
  );
}

export async function POST(req: NextRequest) {
  // 1) Protect
  const err = requireInternalAuth(req);
  if (err) return err;

  // 2) Parse invoiceId
  let body: { invoiceId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { invoiceId } = body;
  if (!invoiceId) {
    return NextResponse.json({ error: "invoiceId is required" }, { status: 400 });
  }

  // 3) Load invoice
  const inv = await db
    .selectFrom('"userInvoices"')
    .select([
      '"id"',
      '"userId"',
      '"totalAmount"',
      '"niftipayNetwork"',
      '"niftipayAsset"',
      '"status"',
      '"niftipayOrderId"',
    ])
    .where('"id"', "=", invoiceId)
    .executeTakeFirst();

  if (!inv) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (inv.niftipayOrderId) {
    return NextResponse.json(
      { error: "On-chain invoice already minted" },
      { status: 409 }
    );
  }

  // 4) Load user info
  const user = await db
    .selectFrom('"user"')
    .select(['"email"', '"name"'])
    .where('"id"', "=", inv.userId)
    .executeTakeFirst();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 5) Call Niftipay
  const payload = {
    network:   inv.niftipayNetwork,
    asset:     inv.niftipayAsset,
    amount:    inv.totalAmount,
    currency:  "USD",                          // Niftipay expects fiat currency
    firstName: user.name?.split(" ")[0] || "",
    lastName:  user.name?.split(" ").slice(1).join(" ") || "",
    email:     user.email,
    merchantId: NIFTIPAY_MERCHANT_ID,
    reference:  inv.id,                        // use our invoiceId for later lookup
  };

  const resp = await fetch(`${NIFTIPAY_API_URL}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    NIFTIPAY_API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const data = await resp.json().catch(() => null);
  if (!resp.ok || !data?.order) {
    return NextResponse.json(
      { error: data?.error || "Failed to create Niftipay invoice" },
      { status: resp.status }
    );
  }

  const o = data.order;
  // 6) Persist on-chain details + mark 'sent'
  await db
    .updateTable('"userInvoices"')
    .set({
      "niftipayOrderId":   o.id,
      "niftipayReference": o.reference,
      "niftipayAddress":   o.address,
      "niftipayQrUrl":     o.qrUrl,
      "status":            "sent",
    })
    .where('"id"', "=", inv.id)
    .execute();

  return NextResponse.json({ order: o });
}
