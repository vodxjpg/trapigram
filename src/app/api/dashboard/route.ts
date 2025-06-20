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
        console.log(orderSorted)

        return NextResponse.json({ orderAmount, revenue, clientAmount, activeAmount, orderList: orderSorted }, { status: 200 });
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json(
            { error: "Internal server error." },
            { status: 500 }
        );
    }
}