// pages/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import crypto from "crypto";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const ENC_KEY_B64 = process.env.ENCRYPTION_KEY || ""
const ENC_IV_B64 = process.env.ENCRYPTION_IV || ""

function getEncryptionKeyAndIv(): { key: Buffer, iv: Buffer } {
    const key = Buffer.from(ENC_KEY_B64, "base64") // decode base64 -> bytes
    const iv = Buffer.from(ENC_IV_B64, "base64")
    // For AES-256, key should be 32 bytes; iv typically 16 bytes
    // Added validation to ensure correct lengths
    if (!ENC_KEY_B64 || !ENC_IV_B64) {
        throw new Error("ENCRYPTION_KEY or ENCRYPTION_IV not set in environment")
    }
    if (key.length !== 32) {
        throw new Error(`Invalid ENCRYPTION_KEY: must decode to 32 bytes, got ${key.length}`)
    }
    if (iv.length !== 16) {
        throw new Error(`Invalid ENCRYPTION_IV: must decode to 16 bytes, got ${iv.length}`)
    }
    return { key, iv }
}

function decryptSecretNode(encryptedB64: string): string {
  const { key, iv } = getEncryptionKeyAndIv();
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encryptedB64, "base64", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    try {

        const { id } = await params
        const getOrder = `
            SELECT * FROM orders
            WHERE "id" = '${id}'
            `;

        const resultOrder = await pool.query(getOrder);
        const order = resultOrder.rows[0];

        const getClient = `
            SELECT * FROM clients
            WHERE "id" = '${order.clientId}'
            `;

        const resultClient = await pool.query(getClient);
        const client = resultClient.rows[0];        

        const getProducts = `
        SELECT 
          p.id, p.title, p.description, p.image, p.sku,
          cp.quantity, cp."unitPrice"
        FROM products p
        JOIN "cartProducts" cp ON p.id = cp."productId"
        WHERE cp."cartId" = $1
      `;
        const resultProducts = await pool.query(getProducts, [order.cartId]);
        const products = resultProducts.rows
        let total = 0

        products.map((p) => {
            p.unitPrice = Number(p.unitPrice)
            total = (p.unitPrice * p.quantity) + total

        })

        const fullOrder = {
            id: order.id,
            cartId: order.cartId,
            clientFirstName: client.firstName,
            clientLastName: client.lastName,
            clientEmail: client.email,
            clientUsername: client.username,
            status: order.status,
            products: products,
            coupon: order.couponCode,
            discount: Number(order.discountTotal),
            shipping: Number(order.shippingTotal),
            subTotal: Number(total),
            total: Number(order.totalAmount),
            shippingInfo:{
                address: decryptSecretNode(order.address),
                company: order.shippingService,
                method: order.shippingMethod,
                payment: order.paymentMethod
            }
        }

        return NextResponse.json(fullOrder, { status: 201 });
    } catch (error) {
        return NextResponse.json(error, { status: 403 });
    }
}