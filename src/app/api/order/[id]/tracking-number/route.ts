import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    try {
        const { id } = await params;
        const body = await req.json();
        console.log(body)

        const trackingQuery = `UPDATE orders
            SET "trackingNumber" = '${body.trackingNumber}', "shippingService" = '${body.shippingCompany}', "updatedAt" = NOW()
            WHERE id = '${id}'
            RETURNING *`

        const trackingResult = await pool.query(trackingQuery)
        const result = trackingResult.rows

        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error }, { status: 500 });
    }
}