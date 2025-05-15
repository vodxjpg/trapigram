import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

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
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

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