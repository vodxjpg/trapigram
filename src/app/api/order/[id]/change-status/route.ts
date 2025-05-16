import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// Updated coupon update schema with new field "expendingMinimum"
const orderStatusSchema = z.object({
    status: z.string()
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    try {
        const { id } = await params;
        console.log(id)
        const body = await req.json();
        const parsedStatus = orderStatusSchema.parse(body)

        const query = `
            UPDATE "orders" SET "status" = '${parsedStatus.status}' WHERE "id" = '${id}' RETURNING *
        `;

        const result = await pool.query(query);
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Order not found" }, { status: 404 });
        }

        const order = result.rows[0];
        return NextResponse.json(order);
    } catch (error: any) {
        console.error("[GET /api/order/[id]/change-status] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}