import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const cartProductSchema = z.object({
    couponCode: z.number(),
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
        SELECT countries FROM coupons 
        WHERE name = '${data.couponCode}' AND "organizationId" = '${organizationId}'
        RETURNING *
      `;

        const countryCoupon = await pool.query(coupon);
        const couponCountry = countryCoupon.rows[0];

        const cart = `
        SELECT countries FROM carts 
        WHERE id = '${id}'
        RETURNING *
      `;

        const countryCart = await pool.query(cart);
        const cartCountry = countryCart.rows[0];

        if (couponCountry === cartCountry) {
            const insert = `
            UPDATE carts 
            SET "couponCode" = $1, "updatedAt" = NOW()
            WHERE id = $2
            RETURNING *
        `;
            const vals = [
                data.couponCode,
                id
            ];

            const result = await pool.query(insert, vals);
            return NextResponse.json(result.rows[0], { status: 201 });
        }else {
            //Error 
        }
    } catch (err: any) {
        console.error("[PATCH /api/cart/:id/update-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}