import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    /* const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx; */
    const organizationId = 'W0duzyHA23ezm9Mcvso1y32KPko4XjRn'

    try {
        const { id } = await params;

        const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`
        const resultCheck = await pool.query(checkQuery);
        const check = resultCheck.rows

        if (check.length == 0) {
            const orderQuery = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`
            const resultOrders = await pool.query(orderQuery);
            const order = resultOrders.rows[0]
            const paymentType = order.paymentMethod

            if (paymentType === 'coinx') {

                const from = Math.floor(order.datePaid / 1000)
                const to = from + 3600

                const url = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const res = await fetch(url, options)
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} – ${res.statusText}`);
                }

                const result = await res.json()
                const price = result.prices[0][1]
                const amount = order.orderMeta[0].order.amount

                const revenueId = uuidv4();
                const query = `INSERT INTO "orderRevenue" (id, "orderId", amount, currency, "createdAt", "updatedAt")
                VALUES ('${revenueId}', '${id}', ${(price * amount).toFixed(2)}, 'USD', NOW(), NOW())
                RETURNING *`

                const resultQuery = await pool.query(query)
                const revenue = resultQuery.rows[0]

                return NextResponse.json(revenue, { status: 200 });

            } else {

                const date = order.datePaid
                const dateString = date.toISOString().substring(0, 10);

                const apiKey = '144659c7b175794ed4eae9bacf853944'
                const url = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&currencies=GBP,USD,EUR`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const res = await fetch(url, options)
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} – ${res.statusText}`);
                }
                const result = await res.json();

            }


        } else {
            return NextResponse.json(check, { status: 200 });
        }


    } catch (error) {
        return NextResponse.json({ error }, { status: 500 });
    }
}

async function getCoinPrice(from, to) {
    const url = `https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const options = { method: 'GET', headers: { accept: 'application/json' } };

    const res = await fetch(url, options)
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} – ${res.statusText}`);
    }
    return res.json();
}

async function getPrice(from) {

    const apiKey = '144659c7b175794ed4eae9bacf853944'
    const url = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${from}&currencies=GBP,USD,EUR`;
    const options = { method: 'GET', headers: { accept: 'application/json' } };

    const res = await fetch(url, options)
    if (!res.ok) {
        throw new Error(`HTTP ${res.status} – ${res.statusText}`);
    }
    return res.json();
}