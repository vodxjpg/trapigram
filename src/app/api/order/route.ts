// pages/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto"
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

// Simple AES encryption using Node’s crypto library in CBC or GCM:
function encryptSecretNode(plain: string): string {
    const { key, iv } = getEncryptionKeyAndIv()
    // For demo: using AES-256-CBC. You can choose GCM or CTR if you wish.
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv)
    let encrypted = cipher.update(plain, "utf8", "base64")
    encrypted += cipher.final("base64")
    return encrypted
}

// 1️⃣ Define Zod schema for order creation
const orderSchema = z.object({
    organization: z.string(),
    clientId: z.string().uuid(),
    cartId: z.string().uuid(),
    country: z.string().length(2),
    paymentMethod: z.string().min(1),
    shippingAmount: z.coerce.number().min(0),
    shippingMethodTitle: z.string(),
    shippingMethodDescription: z.string(),
    discountAmount: z.coerce.number().min(0),
    totalAmount: z.coerce.number().min(0),
    couponCode: z.string().optional().nullable(),
    shippingCompany: z.string().min(1),
    address: z.string().min(1),
});
type OrderPayload = z.infer<typeof orderSchema>;

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const getOrder = `
            SELECT 
            o.*,
            c."firstName",
            c."lastName",
            c."username",
            c.email
            FROM orders AS o
            JOIN clients AS c
            ON o."clientId" = c.id
            WHERE o."organizationId" = '${organizationId}'
        `;

        const resultOrder = await pool.query(getOrder);
        const orders = resultOrder.rows;

        let sampleOrders: Orders[] = []

        orders.map((o) => {
            o.totalAmount = Number(o.totalAmount)
            sampleOrders.push({
                id: o.id,
                status: o.status,
                createdAt: o.createdAt,
                total: o.totalAmount,
                firstName: o.firstName,
                lastName: o.lastName,
                username: o.username,
                email: o.email
            })
        })

        return NextResponse.json(sampleOrders, { status: 201 });
    } catch (error) {
        return NextResponse.json(error, { status: 403 });
    }

}

// 2️⃣ Handle POST
export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    // --- Parse & validate body ---
    let payload: OrderPayload;
    try {
        const body = await req.json();        
        body.organization = organizationId;
        payload = orderSchema.parse(body);
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Destructure for later use
    const {
        organization,
        clientId,
        cartId,
        country,
        paymentMethod,
        shippingAmount,
        shippingMethodTitle,
        shippingMethodDescription,
        discountAmount,
        totalAmount,
        couponCode,
        shippingCompany,
        address,
    } = payload;

    const orderId = uuidv4();
    const encryptedAddress = encryptSecretNode(address);
    const shippingMethod = `${shippingMethodTitle} - ${shippingMethodDescription}`
    const orderStatus = "open"
    const cartStatus = false

    // Build order INSERT SQL & values (you had 13 placeholders)
    const insertSQL = `
    INSERT INTO orders
      (id, "clientId", "organizationId", "cartId", country,
       "paymentMethod", "shippingTotal", "discountTotal",
       "totalAmount", "couponCode", "shippingService", "shippingMethod", address, status, "cartHash", "dateCreated",
       "createdAt", "updatedAt")
    VALUES
      ($1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $15, NOW(),
       NOW(), NOW())
    RETURNING *
  `;
    const values = [
        orderId,
        clientId,
        organization,
        cartId,
        country,
        paymentMethod,
        shippingAmount,
        discountAmount,
        totalAmount,
        couponCode,
        shippingCompany,
        shippingMethod,
        encryptedAddress,
        orderStatus
        // we'll push cartHash below
    ];

    // PREPARE: update cart status + hash
    const encryptedResponse = encryptSecretNode(JSON.stringify(values));
    values.push(encryptedResponse);
    const updateCartSQL = `
    UPDATE carts 
    SET "status" = $1, "updatedAt" = NOW(), "cartHash" = $2
    WHERE id = $3
    RETURNING *
  `;
    const updateCartValues = [cartStatus, encryptedResponse, cartId];

    // 1️⃣ FETCH all cartProducts
    const cartProductsQuery = `
    SELECT * FROM "cartProducts"
    WHERE "cartId" = $1
  `;
    const cartProductsResults = await pool.query(cartProductsQuery, [cartId]);

    // 2️⃣ CHECK stock availability
    const outOfStock: Array<{ productId: string; requested: number; available: number }> = [];
    for (const cp of cartProductsResults.rows) {
        const stockQuery = `
      SELECT quantity FROM "warehouseStock"
      WHERE "productId" = $1 AND country = $2
    `;
        const stockResult = await pool.query(stockQuery, [cp.productId, country]);
        const available = stockResult.rows[0]?.quantity ?? 0;

        if (cp.quantity > available) {
            outOfStock.push({
                productId: cp.productId,
                requested: cp.quantity,
                available,
            });
        }
    }

    // 3️⃣ IF any are out of stock → RETURN error + list
    if (outOfStock.length > 0) {
        return NextResponse.json(
            { error: "Products out of stock", products: outOfStock },
            { status: 400 }
        );
    }

    // 4️⃣ ALL in stock → UPDATE warehouseStock, then CART & ORDER
    try {
        await pool.query("BEGIN");

        // a) decrement every stock
        for (const cp of cartProductsResults.rows) {
            const decrementSQL = `
        UPDATE "warehouseStock"
        SET quantity = quantity - $1, "updatedAt" = NOW()
        WHERE "productId" = $2 AND country = $3
      `;
            await pool.query(decrementSQL, [cp.quantity, cp.productId, country]);
        }

        // b) update cart status/hash
        await pool.query(updateCartSQL, updateCartValues);

        // c) insert order
        const result = await pool.query(insertSQL, values);
        const order = result.rows[0];

        await pool.query("COMMIT");
        return NextResponse.json(order, { status: 201 });
    } catch (error: any) {
        await pool.query("ROLLBACK");
        console.error("[POST /api/orders] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}