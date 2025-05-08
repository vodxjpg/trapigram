// pages/api/orders/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

// 1️⃣ Define Zod schema for order creation
const orderSchema = z.object({
    clientId: z.string().uuid(),
    cartId: z.string().uuid(),
    country: z.string().length(2),
    paymentMethod: z.string().min(1),
    shippingAmount: z.coerce.number().min(0),
    discountAmount: z.coerce.number().min(0),
    totalAmount: z.coerce.number().min(0),
    couponCode: z.string().optional().nullable(),
    shippingCompany: z.string().min(1),
    address: z.string().min(1),
});
type OrderPayload = z.infer<typeof orderSchema>;

// 2️⃣ Handle POST
export async function POST(req: NextRequest) {
    // --- Auth same as coupons endpoint ---
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;
    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    // Session-based
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId!;
    }
    // API Key
    else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        organizationId = explicitOrgId || "";
    }
    // Internal Secret
    else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        organizationId = explicitOrgId || internalSession.session.activeOrganizationId!;
    } else {
        return NextResponse.json(
            { error: "Unauthorized: Provide a valid session, API key, or internal secret" },
            { status: 403 }
        );
    }

    if (!organizationId) {
        return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }

    // --- Parse & validate body ---
    let payload: OrderPayload;
    try {
        const body = await req.json();
        payload = orderSchema.parse(body);
    } catch (err: any) {
        if (err instanceof z.ZodError) {
            return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // --- Insert into DB ---
    const {
        clientId,
        cartId,
        country,
        paymentMethod,
        shippingAmount,
        discountAmount,
        totalAmount,
        couponCode,
        shippingCompany,
        address,
    } = payload;
    const orderId = uuidv4();

    const insertSQL = `
    INSERT INTO orders
      (id, "clientId", "cartId", country,
       "paymentMethod", "shippingTotal", "discountTotal",
       "totalAmount", "couponCode", "shippingService", address,
       "createdAt", "updatedAt")
    VALUES
      ($1, $2, $3, $4, $5,
       $6, $7, $8,
       $9, $10, $11,
       NOW(), NOW())
    RETURNING *
  `;
    const values = [
        orderId,
        clientId,
        cartId,
        country,
        paymentMethod,
        shippingAmount,
        discountAmount,
        totalAmount,
        couponCode,
        shippingCompany,
        address,
    ];

    const status = false

    const insert = `
            UPDATE carts 
            SET "status" = '${status}' , "updatedAt" = NOW()
            WHERE id = '${cartId}'
            RETURNING *
        `;

    try {
        await pool.query(insert);
        const result = await pool.query(insertSQL, values);
        const order = result.rows[0];
        return NextResponse.json(order, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/orders] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
