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
        const queryProducts = `SELECT * FROM products WHERE "organizationId" = '${organizationId}'`
        const resultProducts = await pool.query(queryProducts);
        const products = resultProducts.rows

        const queryCarts = `SELECT "cartId" FROM orders WHERE "organizationId" = '${organizationId}'`
        const resultCarts = await pool.query(queryCarts);
        const carts = resultCarts.rows

        const month = "2025-05"

        const calcData = products.map(async (pt) => {
            let qty = 0
            for (let i = 0; i < carts.length; i++) {
                const queryCalc = `SELECT * FROM "cartProducts" WHERE "cartId" = '${carts[i].cartId}' AND "productId" = '${pt.id}'`
                const resultCalc = await pool.query(queryCalc);
                const result = resultCalc.rows[0]

                if (result !== undefined) {
                    qty = qty + result.quantity
                } else {
                    qty = qty + 0
                }
            }
            return {
                month,
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