import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

interface Period {
    from: Date;
    to: Date;
}

function eachDay(from, to) {
    const days = [];
    let cur = new Date(from);
    while (cur <= to) {
        days.push(new Date(cur));
        cur.setDate(cur.getDate() + 1);
    }
    return days;
}

function splitIntoCurrentAndPrevious(currentFrom: Date, currentTo: Date): {
    current: Period;
    previous: Period;
} {
    // 1) compute the length of the current period (in ms)
    const spanMs = currentTo.getTime() - currentFrom.getTime();

    // 2) previousTo is one millisecond before currentFrom
    const previousTo = new Date(currentFrom.getTime() - 1);

    // 3) previousFrom is previousTo minus spanMs
    const previousFrom = new Date(previousTo.getTime() - spanMs);

    return {
        current: { from: currentFrom, to: currentTo },
        previous: { from: previousFrom, to: previousTo },
    };
}

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    console.log(to, from)

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
        const orderQuery = `
        SELECT * FROM "orders"
        WHERE "organizationId" = $1 AND "createdAt" BETWEEN $2::timestamptz AND $3::timestamptz
        `;
        const values = [organizationId, from, to];

        const orderResult = await pool.query(orderQuery, values);
        const orders = orderResult.rows
        const orderAmount = orders.length

        const revenueQuery = `SELECT * FROM "orderRevenue"
        WHERE "organizationId" = $1 AND "createdAt" BETWEEN $2::timestamptz AND $3::timestamptz`;

        const revenueResult = await pool.query(revenueQuery, values);
        const revenues = revenueResult.rows

        const revenue = revenues.reduce((acc, o) => {
            const total = parseFloat(o.total);
            const discount = parseFloat(o.discount);
            const shipping = parseFloat(o.shipping);
            const cost = parseFloat(o.cost);

            const profit = total - discount - shipping - cost;

            return acc + profit;
        }, 0);

        const clientQuery = `SELECT * FROM "clients"
        WHERE "organizationId" = $1 AND "createdAt" BETWEEN $2::timestamptz AND $3::timestamptz`;

        const clientResult = await pool.query(clientQuery, values);
        const clients = clientResult.rows
        const clientAmount = clients.length

        const activeQuery = `SELECT * FROM "clients"
        WHERE "organizationId" = $1 AND "updatedAt" BETWEEN $2::timestamptz AND $3::timestamptz`;

        const activeResult = await pool.query(activeQuery, values);
        const actives = activeResult.rows
        const activeAmount = actives.length

        const orderListQuery = `SELECT o.*, c."firstName", c."lastName", c."username", c.email
        FROM   orders o
        JOIN   clients c ON c.id = o."clientId"
        WHERE  o."organizationId" = '${organizationId}'
        ORDER BY "dateCreated" DESC LIMIT 10`

        const orderListResult = await pool.query(orderListQuery);
        const orderList = orderListResult.rows

        const orderSorted: {
            id: string,
            orderNumber: string,
            user: string,
            status: string,
            date: Date,
            total: number,
        }[] = []

        for (const od of orderList) {
            orderSorted.push({
                id: od.id,
                orderNumber: od.orderKey,
                user: `${od.firstName} ${od.lastName} - ${od.username} (${od.email})`,
                status: od.status,
                date: od.dateCreated,
                total: od.totalAmount
            })
        }

        const chartQuery = `SELECT * FROM "orderRevenue"
        WHERE "organizationId" = $1 AND "createdAt" BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY "createdAt" DESC`;

        const chartResult = await pool.query(chartQuery, values);
        const chart = chartResult.rows

        const byDay = chart.reduce((acc, o) => {
            const day = new Date(o.createdAt).toISOString().split('T')[0]; // 'YYYY-MM-DD'
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

        const { current, previous } = splitIntoCurrentAndPrevious(fromDate, toDate);

        const revenueGrowthQuery = `SELECT * FROM "orderRevenue"
        WHERE "organizationId" = $1 AND "createdAt" BETWEEN $2::timestamptz AND $3::timestamptz`;

        const growthValues = [organizationId, previous.from, previous.to]

        const revenueGrowthResult = await pool.query(revenueGrowthQuery, growthValues);
        const revenuesGrowth = revenueGrowthResult.rows

        const revenueGrowth = revenuesGrowth.reduce((acc, o) => {
            const total = parseFloat(o.total);
            const discount = parseFloat(o.discount);
            const shipping = parseFloat(o.shipping);
            const cost = parseFloat(o.cost);

            const profit = total - discount - shipping - cost;

            return acc + profit;
        }, 0);

        const growthRate = revenueGrowth > 0
            ? (revenue - revenueGrowth) / revenueGrowth
            : "100%";

        return NextResponse.json({ orderAmount, revenue, clientAmount, activeAmount, orderList: orderSorted, chartData, growthRate }, { status: 200 });
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json(
            { error: "Internal server error." },
            { status: 500 }
        );
    }
}