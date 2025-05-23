import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/* ---------- encryption helpers ---------------------------------- */
const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || "";
const ENC_IV_B64  = process.env.ENCRYPTION_IV  || "";

function getEncryptionKeyAndIv(): { key: Buffer; iv: Buffer } {
  const key = Buffer.from(ENC_KEY_B64, "base64");
  const iv  = Buffer.from(ENC_IV_B64, "base64");
  if (!ENC_KEY_B64 || !ENC_IV_B64) throw new Error("ENC vars not set");
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
/* GET – full order                                                  */
/* ================================================================= */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { id } = await params;

  const orderRes = await pool.query(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!orderRes.rowCount)
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  const order = orderRes.rows[0];

  const clientRes = await pool.query(`SELECT * FROM clients WHERE id = $1`, [
    order.clientId,
  ]);
  const client = clientRes.rows[0];

  const prodSql = `
    SELECT p.id, p.title, p.description, p.image, p.sku,
           cp.quantity, cp."unitPrice"
    FROM   products p
    JOIN   "cartProducts" cp ON p.id = cp."productId"
    WHERE  cp."cartId" = $1
  `;
  const prods = await pool.query(prodSql, [order.cartId]);
  const products = prods.rows.map(p => ({
    ...p,
    unitPrice: Number(p.unitPrice),
  }));
  const subtotal = products.reduce(
    (t, p) => t + p.unitPrice * p.quantity,
    0,
  );

  const full = {
    id: order.id,
    orderKey: order.orderKey,
    clientId: client.id,
    cartId: order.cartId,
    status: order.status,
    country: order.country,
    products,
    coupon: order.couponCode,
    couponType: order.couponType,
    discount: Number(order.discountTotal),
    shipping: Number(order.shippingTotal),
    subtotal,
    total: Number(order.totalAmount),
    trackingNumber: order.trackingNumber,
    shippingInfo: {
      address: decryptSecretNode(order.address),
      company: order.shippingService,
      method: order.shippingMethod,
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
  const body   = await req.json();

  /* only update provided keys ------------------------------------- */
  const fields: string[] = [];
  const values: unknown[] = [];

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
