import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto"
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

const cartProductSchema = z.object({
    productId: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {
        const { id } = await params;
        const body = await req.json();
        const cartProductId = uuidv4();

        const productCartQuery = `
        SELECT * FROM "cartProducts"
        WHERE "productId" = '${body.productId}' AND "cartId" = '${id}'
      `;

        const resultProductCart = await pool.query(productCartQuery);


        if (resultProductCart.rows.length > 0) {
            const newQuantity = resultProductCart.rows[0].quantity + body.quantity
            const updateProductCart = `
            UPDATE "cartProducts"
            SET quantity = '${newQuantity}'
            WHERE "productId" = '${body.productId}' AND "id" = '${resultProductCart.rows[0].id}'
            `

            await pool.query(updateProductCart);

            const productQuery = `
                SELECT * FROM products
                WHERE id = '${body.productId}'
            `;

            const resultProduct = await pool.query(productQuery);

            const product = resultProduct.rows[0]
            product.subtotal = body.price * newQuantity

            const cartItem = {
                product: product,
                quantity: newQuantity,
            }
            const encryptedResponse = encryptSecretNode(JSON.stringify(cartItem))

            await pool.query(`UPDATE carts 
            SET "cartUpdatedHash" = '${encryptedResponse}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`)

            return NextResponse.json(cartItem, { status: 201 });
        } else {
            const productQuery = `
                SELECT * FROM products
                WHERE id = '${body.productId}'
            `;

            const resultProduct = await pool.query(productQuery);
            body.unitPrice = body.price
            const data = cartProductSchema.parse(body); // throws if invalid        

            const insert = `
                INSERT INTO "cartProducts" (id, "cartId", "productId", quantity, "unitPrice", "createdAt", "updatedAt")
                VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
                RETURNING *
            `;
            const vals = [
                cartProductId,
                id,
                data.productId,
                data.quantity,
                data.unitPrice,
            ];

            await pool.query(insert, vals);

            const product = resultProduct.rows[0]
            product.subtotal = body.price * data.quantity

            const cartItem = {
                product: product,
                quantity: data.quantity
            }
            const encryptedResponse = encryptSecretNode(JSON.stringify(cartItem))
            await pool.query(`UPDATE carts 
            SET "cartUpdatedHash" = '${encryptedResponse}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`)

            return NextResponse.json(cartItem, { status: 201 });
        }


    } catch (err: any) {
        console.error("[POST /api/cart/:id/add-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}