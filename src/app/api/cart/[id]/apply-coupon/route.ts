import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import crypto from "crypto"

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;
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
    code: z.string(),
    total: z.number()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    /* --- 3.1  Auth (same block as above) ----------------------------------- */
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    const { searchParams } = new URL(req.url);

    const explicitOrgId = searchParams.get("organizationId");
    let organizationId: string;

    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId)
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    } else if (apiKey) {
        const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        organizationId = explicitOrgId || "";
        if (!organizationId)
            return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const s = await auth.api.getSession({ headers: req.headers });
        if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        organizationId = explicitOrgId || s.session.activeOrganizationId;
        if (!organizationId)
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {

        const { id } = await params;
        const body = await req.json();
        const data = cartProductSchema.parse(body); // throws if invalid        

        const coupon = `
        SELECT * FROM coupons 
        WHERE code = '${data.code}' AND "organizationId" = '${organizationId}'
      `;

        const appliedCoupon = await pool.query(coupon);
        const couponCountry = JSON.parse(appliedCoupon.rows[0].countries);

        const cart = `
        SELECT * FROM carts 
        WHERE id = '${id}'
      `;

        const currentCart = await pool.query(cart);
        const cartCountry = currentCart.rows[0].country;

        if (couponCountry.includes(cartCountry)) {

            const startDate = appliedCoupon.rows[0].startDate
            const expirationDate = appliedCoupon.rows[0].expirationDate

            const date = new Date()

            if (date < startDate) {
                return NextResponse.json({ error: "Coupon is not valid yet" }, { status: 400 });
            }

            if (date > expirationDate && expirationDate !== null) {
                return NextResponse.json({ error: "Coupon is expired" }, { status: 400 });
            }

            const limit = `
            SELECT * FROM orders
            WHERE "clientId"= '${currentCart.rows[0].clientId}' AND "couponCode" = '${data.code}'
            `

            const currentLimit = await pool.query(limit);
            const clientLimit = currentLimit.rows.length
            const couponLimit = appliedCoupon.rows[0].limitPerUser

            if (clientLimit >= couponLimit && couponLimit !== 0) {
                return NextResponse.json({ error: "Coupon limit per user reached" }, { status: 400 });
            }

            const usage = `
            SELECT * FROM orders
            WHERE "couponCode" = '${data.code}' AND "organizationId"= '${organizationId}'
            `

            const currentUsage = await pool.query(usage);
            const usageLimit = currentUsage.rows.length
            const couponUsage = appliedCoupon.rows[0].usageLimit

            if (usageLimit >= couponUsage && usageLimit !== 0) {
                return NextResponse.json({ error: "Coupon usage limit reached" }, { status: 400 });
            }

            const total = data.total
            const minimum = appliedCoupon.rows[0].expendingMinimum
            const maximum = appliedCoupon.rows[0].expendingLimit
            let discountAmount = 0

            if (total < minimum) {
                return NextResponse.json({ error: "Total amount is minimum than needed" }, { status: 400 });
            }

            if (total > maximum) {
                if (appliedCoupon.rows[0].discountType === "percentage") {
                    discountAmount = ((appliedCoupon.rows[0].expendingLimit * appliedCoupon.rows[0].discountAmount) / 100).toFixed(2)
                } else {
                    discountAmount = appliedCoupon.rows[0].discountAmount
                }
            }

            const insert = `
            UPDATE carts 
            SET "couponCode" = $1, "updatedAt" = NOW()
            WHERE id = $2
            RETURNING *
            `;
            const vals = [
                data.code,
                id
            ];

            await pool.query(insert, vals);
            const discount = {
                discountType: appliedCoupon.rows[0].discountType, discountValue: appliedCoupon.rows[0].discountAmount, discountAmount
            }

            const encryptedResponse = encryptSecretNode(JSON.stringify(discount))

            await pool.query(`UPDATE carts 
            SET "cartUpdatedHash" = '${encryptedResponse}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`)

            return NextResponse.json(discount, { status: 201 });
        }

        if (!couponCountry.includes(cartCountry)) {
            const setCoupon = `
            UPDATE carts 
            SET "couponCode" = NULL, "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *
        `;

            const removed = await pool.query(setCoupon);
            const discount = {
                cc: removed.rows[0].couponCode
            }

            const encryptedResponse = encryptSecretNode(JSON.stringify(discount))

            await pool.query(`UPDATE carts 
            SET "cartUpdatedHash" = '${encryptedResponse}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`)
            
            return NextResponse.json(discount, { status: 201 });
        }
    } catch (err: any) {
        console.error("[PATCH /api/cart/:id/update-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}