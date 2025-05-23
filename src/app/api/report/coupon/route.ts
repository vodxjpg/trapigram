import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const queryOrders = `SELECT * FROM carts WHERE "organizationId" = '${organizationId}'`
        const resultorders = await pool.query(queryOrders);
        const orders = resultorders.rows.length

        const queryCoupon = `SELECT code FROM coupons WHERE "organizationId" = '${organizationId}'`
        const resultCoupon = await pool.query(queryCoupon);
        const coupons = resultCoupon.rows

        const month = "2025-05"

        const calcData = coupons.map(async (cp) => {
            const queryCalc = `SELECT * FROM orders WHERE "organizationId" = '${organizationId}' AND "couponCode" = '${cp.code}' AND status = 'completed'`
            const resultCalc = await pool.query(queryCalc);
            const result = resultCalc.rows
            let totalDiscount = 0
            let revenueAfterDiscount = 0
            for (let i = 0; i < result.length; i++) {
                totalDiscount = Number(result[i].discountTotal) + totalDiscount
                revenueAfterDiscount = (Number(result[i].subtotal) - Number(result[i].discountTotal)) + revenueAfterDiscount
            }
            return {
                month,
                couponCode: cp.code,
                redemptions: result.length,
                totalOrders: orders,
                totalDiscount: totalDiscount,
                revenueAfterDiscount: revenueAfterDiscount
            }
        })
        const data = await Promise.all(calcData);

        const values = {
            stats: data
        }

        return NextResponse.json({ values }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/coupon/]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}