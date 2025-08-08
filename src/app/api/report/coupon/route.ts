import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { searchParams } = new URL(req.url)
        const from = searchParams.get('from')
        const to = searchParams.get('to')

        const queryOrders = `SELECT * FROM orders WHERE "organizationId" = '${organizationId}' AND (status = 'completed' OR status = 'paid') AND "createdAt" BETWEEN '${from}' AND '${to}'`
        const resultorders = await pool.query(queryOrders);
        const orders = resultorders.rows.length

        const queryCoupon = `SELECT id, code, "createdAt" FROM coupons WHERE "organizationId" = '${organizationId}'`
        const resultCoupon = await pool.query(queryCoupon);
        const coupons = resultCoupon.rows

        const calcData = coupons.map(async (cp) => {
            const queryCalc = `SELECT * FROM orders WHERE "organizationId" = '${organizationId}' AND "couponCode" = '${cp.code}' AND (status = 'completed' OR status = 'paid') AND "createdAt" BETWEEN '${from}' AND '${to}'`
            const resultCalc = await pool.query(queryCalc);
            const result = resultCalc.rows
            let totalDiscount = 0
            let revenueAfterDiscount = 0
            for (let i = 0; i < result.length; i++) {
                totalDiscount = Number(result[i].discountTotal) + totalDiscount
                revenueAfterDiscount = (Number(result[i].subtotal) - Number(result[i].discountTotal)) + revenueAfterDiscount
            }
            return {
                id: cp.id,
                month: cp.createdAt,
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