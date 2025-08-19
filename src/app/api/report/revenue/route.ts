// app/api/report/revenue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

// nothing

function eachDay(from, to) {
    const days = [];
    let cur = new Date(from);
    while (cur <= to) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const currency = url.searchParams.get("currency")

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
            r."${currency}total"       AS "totalPrice",
            r."${currency}shipping"    AS "shippingCost",
            r."${currency}discount" AS "discount",
            r."${currency}cost" AS "cost",
            r.cancelled AS status,
            o."orderMeta" AS asset
        FROM "orderRevenue" r
        JOIN orders o
            ON r."orderId" = o.id
        WHERE
            r."organizationId" = $1
            AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY o."orderKey" DESC
    `;
        const values = [organizationId, from, to];

        const result = await pool.query(revenueQuery, values);
        const row = result.rows
        row.map((m) => {
            if (m.asset.length > 0) {
                m.coin = m.asset[0].order.asset
            } else {
                m.coin = ""
            }
            m.netProfit = m.totalPrice - m.shippingCost - m.discount - m.cost
        })
        console.log(row)

        const chartQuery = `SELECT DATE(o."datePaid"), r.id, r."orderId", r."${currency}total" AS total, r."${currency}shipping" AS shipping, r."${currency}discount" AS discount, r."${currency}cost" AS cost, 
            r."createdAt", r."updatedAt", r."organizationId"  FROM "orderRevenue" r
            JOIN orders o
            ON r."orderId" = o.id
            WHERE r."organizationId" = $1 AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz AND r.cancelled = FALSE
            ORDER BY o."datePaid" DESC`;

        const chartResult = await pool.query(chartQuery, values);
        const chart = chartResult.rows

        const byDay = chart.reduce((acc, o) => {
            const day = new Date(o.date).toISOString().split('T')[0];
            const total = parseFloat(o.total);
            const discount = parseFloat(o.discount);
            const shipping = parseFloat(o.shipping);
            const cost = parseFloat(o.cost);
            const revenue = total - discount - shipping - cost;

            if (!acc[day]) {
                acc[day] = { total: 0, revenue: 0 };
            }
            acc[day].total += total;
            acc[day].revenue += revenue;
            return acc;
        }, {});

        const fromDate = new Date(from)
        const toDate = new Date(to)

        const days = eachDay(fromDate, toDate)

        const chartData = days.map(d => {
            const key = d.toISOString().split('T')[0];
            return {
                date: key,
                total: byDay[key]?.total ?? 0,
                revenue: byDay[key]?.revenue ?? 0,
            };
        });

        return NextResponse.json({ orders: row, chartData: chartData }, { status: 200 });
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json(
            { error: "Internal server error." },
            { status: 500 }
        );
    }
}
