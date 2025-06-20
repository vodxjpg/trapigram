// app/api/report/revenue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    if (!from || !to) {
        return NextResponse.json(
            { error: "Missing required query parameters `from` and `to`." },
            { status: 400 }
        );
    }

    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const revenueQuery = `
      SELECT
        o."datePaid",
        o."orderKey"   AS "orderNumber",
        o."clientId"   AS "userId",
        o.country,
        r.total       AS "totalPrice",
        r.shipping    AS "shippingCost",
        r.discount,
        r.cost,
        o."orderMeta" AS asset
      FROM "orderRevenue" r
      JOIN orders o
        ON r."orderId" = o.id
      WHERE
        r."organizationId" = $1
        AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
      ORDER BY o."datePaid" DESC
    `;
        const values = [organizationId, from, to];

        const result = await pool.query(revenueQuery, values);
        const row = result.rows
        row.map((m) => {
            console.log(m)
            if (m.asset.length > 0) {
                m.coin = m.asset[0].order.asset
            } else {
                m.coin = ""
            }
            m.netProfit = m.totalPrice - m.shippingCost - m.discount - m.cost
        })

        return NextResponse.json({ orders: row }, { status: 200 });
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json(
            { error: "Internal server error." },
            { status: 500 }
        );
    }
}
