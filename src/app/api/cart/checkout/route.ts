import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const orderSchema = z.object({
    id: z.string(),
    clientId: z.string(),
    cartId: z.string(),
    country: z.string(),
    status: z.string(),
    paymentMethod: z.string(),
    orderKey: z.string(),
    cartHash: z.string(),
    shippinTotal: z.number(),
    discountTotal: z.number().optional(),
    totalAmount: z.number(),
    couponCode: z.string().optional(),
    shippingService: z.string(),
    dateCreated: z.date(),
    datePaid: z.date().optional(),
    dateCompleted: z.date().optional(),
    dateCancelled: z.date().optional(),
});

export async function POST(req: NextRequest) {
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
        const body = await req.json();
        const data = orderSchema.parse(body); // throws if invalid

        const orderId = uuidv4();

        const insert = `
        INSERT INTO orders (id, "clientId", "cartId", country, status, "paymentMethod", "orderKey", "cartHash", "shippinTotal", "discountTotal", "totalAmount", "couponCode", "shippingService", "dateCreated", "datePaid", "dateCompleted", "dateCancelled", "createdAt", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
        RETURNING *
      `;
        const vals = [
            orderId,
            data.clientId,
            data.cartId,
            data.country,
            data.status,
            data.paymentMethod,
            data.orderKey,
            data.cartHash,
            data.shippinTotal,
            data.discountTotal,
            data.totalAmount,
            data.couponCode,
            data.shippinTotal,
            data.dateCreated,
            data.datePaid,
            data.dateCompleted,
            data.dateCancelled
        ];

        const result = await pool.query(insert, vals);
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err: any) {
        console.error("[POST /api/cart/:id/add-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}