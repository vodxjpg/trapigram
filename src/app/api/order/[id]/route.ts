// src/app/api/order/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { z } from "zod";
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ─── encryption helpers ─────────────────────────────────────── */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64 = process.env.ENCRYPTION_IV || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv = Buffer.from(ENC_IV_B64, "base64");
  if (key.length !== 32) throw new Error("ENCRYPTION_KEY must be 32-byte");
  if (iv.length !== 16) throw new Error("ENCRYPTION_IV must be 16-byte");
  return { key, iv };
}

function encryptSecretNode(plain: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  return cipher.update(plain, "utf8", "base64") + cipher.final("base64");
}

function decryptSecretNode(enc: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const d = crypto.createDecipheriv("aes-256-cbc", key, iv);
  return d.update(enc, "base64", "utf8") + d.final("utf8");
}

/* ================================================================= */
/* GET – full order with both normal & affiliate products             */
/* ================================================================= */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;

  // 1. Load order
  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!orderRes.rowCount)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = orderRes.rows[0];

  // 2. Load client
  const clientRes = await pool.query(`SELECT * FROM clients WHERE id = $1`, [
    order.clientId,
  ]);
  const client = clientRes.rows[0];

  // 3. Pull in normal products
  const normalRes = await pool.query(
    `
    SELECT
      p.id,
      p.title,
      p.description,
      p.image,
      p.sku,
      cp.quantity,
      cp."unitPrice"
    FROM products p
    JOIN "cartProducts" cp
      ON p.id = cp."productId"
    WHERE cp."cartId" = $1
    ORDER BY p.title
  `,
    [order.cartId]
  );

  // 4. Pull in affiliate products
  const affRes = await pool.query(
    `
    SELECT
      ap.id,
      ap.title,
      ap.description,
      ap.image,
      ap.sku,
      cp.quantity,
      cp."unitPrice"
    FROM "affiliateProducts" ap
    JOIN "cartProducts" cp
      ON ap.id = cp."affiliateProductId"
    WHERE cp."cartId" = $1
    ORDER BY ap.title
  `,
    [order.cartId]
  );

  // 5. Merge both lists
  const all = [
    ...normalRes.rows.map((r: any) => ({ ...r, isAffiliate: false })),
    ...affRes.rows.map((r: any) => ({ ...r, isAffiliate: true })),
  ];

  const products = all.map((r: any) => ({
    id:          r.id,
    title:       r.title,
    description: r.description,
    image:       r.image,
    sku:         r.sku,
    quantity:    r.quantity,
    unitPrice:   Number(r.unitPrice),
    isAffiliate: r.isAffiliate,
    subtotal:    Number(r.unitPrice) * r.quantity,
  }));

// 6. Compute subtotal *only* across non-affiliate (monetary) items
const subtotal = products
  .filter(p => !p.isAffiliate)
  .reduce((sum, p) => sum + p.subtotal, 0);

  // 7. Build full response
  const full = {
    id:        order.id,
    orderKey:  order.orderKey,
    clientId:  order.clientId,
    cartId:    order.cartId,
    status:    order.status,
    country:   order.country,
    products,
    coupon:    order.couponCode,
    couponType:    order.couponType,
    discount:      Number(order.discountTotal),
    discountValue: Number(order.discountValue),
    shipping:      Number(order.shippingTotal),
    subtotal,
    total:         Number(order.totalAmount),
    pointsRedeemed:        order.pointsRedeemed,
    pointsRedeemedAmount:  Number(order.pointsRedeemedAmount),
    trackingNumber:       order.trackingNumber,
    shippingInfo: {
      address: decryptSecretNode(order.address),
      company: order.shippingService,
      method:  order.shippingMethod,
      payment: order.paymentMethod,
    },
    client: {
      firstName: client.firstName,
      lastName:  client.lastName,
      username:  client.username,
      email:     client.email,
    },
  };

  return NextResponse.json(full, { status: 200 });
}

/* ================================================================= */
/* PATCH – update editable fields (address, totals, tracking)        */
/* ================================================================= */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const body = await req.json();

  const fields: string[] = [];
  const values: any[] = [];

  // ── 1. orderMeta  (expects array) ────────────────────────────
if ("orderMeta" in body) {
  const metaArr = z.array(z.any()).parse(body.orderMeta);          // basic guard
  /*  jsonb concatenation: existing || new_chunk  */
  fields.push(
    `"orderMeta" = COALESCE("orderMeta",'[]'::jsonb) || $${fields.length + 1}::jsonb`
  );
  values.push(JSON.stringify(metaArr));
}

  if ("discount" in body) {
    fields.push(`"discountTotal" = $${fields.length + 1}`);
    values.push(body.discount);
  }
  if ("couponCode" in body) {
    fields.push(`"couponCode" = $${fields.length + 1}`);
    values.push(body.couponCode);
  }
  if ("address" in body) {
    fields.push(`address = $${fields.length + 1}`);
    values.push(encryptSecretNode(body.address));
  }
  if ("total" in body) {
    fields.push(`"totalAmount" = $${fields.length + 1}`);
    values.push(body.total);
  }
  if ("trackingNumber" in body) {
    fields.push(`"trackingNumber" = $${fields.length + 1}`);
    values.push(body.trackingNumber || null);
  }

  if (!fields.length)
    return NextResponse.json({ error: "No updatable fields" }, { status: 400 });

  const sql = `
    UPDATE orders
    SET ${fields.join(", ")}, "updatedAt" = NOW()
    WHERE id = $${fields.length + 1}
    RETURNING *
  `;
  values.push(id);
  const r = await pool.query(sql, values);

  return NextResponse.json(r.rows[0], { status: 200 });
}
