// src/app/api/internal/niftipay-invoice/route.ts
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireInternalAuth } from "@/lib/internalAuth";

const NIFTIPAY_API_URL = process.env.NIFTIPAY_API_URL;
const NIFTIPAY_API_KEY = process.env.NIFTIPAY_API_KEY;
const NIFTIPAY_MERCHANT_ID = process.env.NIFTIPAY_MERCHANT_ID;

if (!NIFTIPAY_API_URL || !NIFTIPAY_API_KEY || !NIFTIPAY_MERCHANT_ID) {
  throw new Error("Missing NIFTIPAY_API_URL, NIFTIPAY_API_KEY, or NIFTIPAY_MERCHANT_ID");
}

export async function POST(req: NextRequest) {
  // 1) Protect the endpoint with internal authentication
  const err = requireInternalAuth(req);
  if (err) return err;

  // 2) Parse the invoiceId from the request body
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

  // 3) Load invoice details from the database
  const inv = await db
    .selectFrom("userInvoices")
    .select([
      "id",
      "userId",
      "totalAmount",
      "niftipayNetwork",
      "niftipayAsset",
      "status",
      "niftipayOrderId",
    ])
    .where("id", "=", invoiceId)
    .executeTakeFirst();

  if (!inv) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  // Do not mint zero-amount invoices (should already be skipped upstream, this is a hard guard)
  const amt = Number(inv.totalAmount);
  if (!isFinite(amt) || amt <= 0) {
    return NextResponse.json(
      { error: "Zero-amount invoices are not minted" },
      { status: 400 },
    );
  }

  if (inv.niftipayOrderId) {
    return NextResponse.json(
      { error: "On-chain invoice already minted" },
      { status: 409 }
    );
  }

  // 4) Load user information from the database
  const user = await db
    .selectFrom("user")
    .select(["email", "name"])
    .where("id", "=", inv.userId)
    .executeTakeFirst();

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // 5) Construct payload and call Niftipay API
  const payload = {
    network: inv.niftipayNetwork,
    asset: inv.niftipayAsset,
    amount: inv.totalAmount,
    currency: "USD", // Verify if this should be configurable
    firstName: user.name?.split(" ")[0] || "",
    lastName: user.name?.split(" ").slice(1).join(" ") || "",
    email: user.email,
    merchantId: NIFTIPAY_MERCHANT_ID,
    reference: inv.id, // Use invoiceId for reference
  };

  const resp = await fetch(`${NIFTIPAY_API_URL}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": NIFTIPAY_API_KEY,
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

  // 6) Persist Niftipay order details and update status within a transaction
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .updateTable("userInvoices")
        .set({
          niftipayOrderId: o.id,
          niftipayReference: o.reference,
          niftipayAddress: o.address,
          niftipayQrUrl: o.qrUrl,
          status: "sent",
        })
        .where("id", "=", inv.id)
        .execute();
    });
  } catch (error) {
    console.error("Database update failed:", error);
    return NextResponse.json({ error: "Failed to update invoice" }, { status: 500 });
  }

  return NextResponse.json({ order: o });
}