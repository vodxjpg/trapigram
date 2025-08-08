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

        const queryProducts = `SELECT * FROM products WHERE "organizationId" = '${organizationId}'`
        const resultProducts = await pool.query(queryProducts);
        const products = resultProducts.rows

        const queryCarts = `SELECT "cartId" FROM orders WHERE "organizationId" = '${organizationId}' AND (status = 'completed' OR status = 'paid')`
        const resultCarts = await pool.query(queryCarts);
        const carts = resultCarts.rows

        const calcData = products.map(async (pt) => {
            let qty = 0

            for (let i = 0; i < carts.length; i++) {
                const queryCalc = `SELECT * FROM "cartProducts" WHERE "cartId" = '${carts[i].cartId}' AND "productId" = '${pt.id}' AND "createdAt" BETWEEN '${from}' AND '${to}'`
                const resultCalc = await pool.query(queryCalc);
                const result = resultCalc.rows[0]

                if (result !== undefined) {
                    qty = qty + result.quantity
                } else {
                    qty = qty + 0
                }
            }
            return {
                id: pt.id,
                month: pt.createdAt,
                product: pt.title,
                sku: pt.sku,
                quantity: qty
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