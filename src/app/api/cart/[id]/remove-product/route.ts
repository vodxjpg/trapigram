import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
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
});

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {
        const { id } = await params;
        const body = await req.json();
        const data = cartProductSchema.parse(body); // throws if invalid

        const insert = `
        DELETE FROM "cartProducts" 
        WHERE "cartId" = $1 AND "productId" = $2
        RETURNING *
      `;
        const vals = [
            id,
            data.productId
        ];

        const result = await pool.query(insert, vals);

        const encryptedResponse = encryptSecretNode(JSON.stringify(result.rows[0]))

        await pool.query(`UPDATE carts 
            SET "cartUpdatedHash" = '${encryptedResponse}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`)


        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err: any) {
        console.error("[DELETE /api/cart/:id/remove-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}