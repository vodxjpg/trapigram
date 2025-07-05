import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

// nothing

const euroCountries = [
    "AT", // Austria
    "BE", // Belgium
    "HR", // Croatia (used HRK, now uses EUR since Jan 2023, remove if current)
    "CY", // Cyprus
    "EE", // Estonia
    "FI", // Finland
    "FR", // France
    "DE", // Germany
    "GR", // Greece
    "IE", // Ireland
    "IT", // Italy
    "LV", // Latvia
    "LT", // Lithuania
    "LU", // Luxembourg
    "MT", // Malta
    "NL", // Netherlands
    "PT", // Portugal
    "SK", // Slovakia
    "SI", // Slovenia
    "ES"  // Spain
];

const coins = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum',
    'USDT': 'tether',
    'USDT.ERC20': 'tether',
    'USDT.TRC20': 'tether',
    'XRP': 'ripple',
    'SOL': 'solana',
    'ADA': 'cardano',
    'LTC': 'litecoin',
    'DOT': 'polkadot',
    'BCH': 'bitcoin-cash',
    'LINK': 'chainlink',
    'BNB': 'binancecoin',
    'DOGE': 'dogecoin',
    'MATIC': 'matic-network',
    'XMR': 'monero'
}

type CategoryRevenue = {
    categoryId: string,
    price: number,
    cost: number,
    quantity: number
}

type TransformedCategoryRevenue = {
    categoryId: string;
    total: number;
    cost: number;
};

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    /* const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx; */
    const organizationId = "W0duzyHA23ezm9Mcvso1y32KPko4XjRn"

    try {
        const { id } = await params;
        const apiKey = '144659c7b175794ed4eae9bacf853944'

        const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`
        const resultCheck = await pool.query(checkQuery);
        const check = resultCheck.rows

        if (check.length === 0) {
            const orderQuery = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`
            const resultOrders = await pool.query(orderQuery);
            const order = resultOrders.rows[0]

            const cartId = order.cartId
            const paymentType = order.paymentMethod
            const country = order.country

            const date = order.datePaid
            const dateString = date.toISOString().substring(0, 10);
            const from = Math.floor(order.datePaid / 1000)
            const to = from + 3600

            const productQuery = `SELECT p.*, cp.quantity
                    FROM "cartProducts" cp
                    JOIN products p ON cp."productId" = p.id
                    WHERE cp."cartId" = '${cartId}'`

            const productResult = await pool.query(productQuery)
            const products = productResult.rows

            const categoryQuery = `SELECT
                cp.*,
                p.*,
                pc."categoryId"
                FROM
                "cartProducts" AS cp
                JOIN "products" AS p
                    ON cp."productId" = p."id"
                LEFT JOIN "productCategory" AS pc
                    ON pc."productId" = p."id"
                WHERE cp."cartId" = '${cartId}'`

            const categoryResult = await pool.query(categoryQuery)
            const categoryData = categoryResult.rows

            const categories: CategoryRevenue[] = [];

            for (const ct of categoryData) {
                categories.push({
                    categoryId: ct.categoryId,
                    price: ct.regularPrice[country],
                    cost: ct.cost[country],
                    quantity: ct.quantity
                })
            }

            const newCategories: TransformedCategoryRevenue[] = categories.map(({ categoryId, price, cost, quantity }) => ({
                categoryId,
                total: price * quantity,
                cost: cost * quantity,
            }));

            const totalCost = products.reduce((sum, product) => {
                return sum + ((product.cost[country] * product.quantity) || 0);
            }, 0);

            let total = 0

            if (paymentType === 'niftipay') {

                const coin = order.orderMeta[0].order.asset
                const url = `https://api.coingecko.com/api/v3/coins/${coins[coin]}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const res = await fetch(url, options)
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} – ${res.statusText}`);
                }

                const result = await res.json()
                const price = result.prices[0][1]
                const amount = order.orderMeta[0].order.amount
                total = amount * price
            }

            const revenueId = uuidv4();

            if (country === 'GB') {
                const discountGBP = Number(order.discountTotal)
                const shippingGBP = Number(order.shippingTotal)
                const costGBP = totalCost
                let totalGBP = Number(order.totalAmount)

                const urlUSD = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=GBP&currencies=USD`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const resUSD = await fetch(urlUSD, options)
                if (!resUSD.ok) {
                    throw new Error(`HTTP ${resUSD.status} – ${resUSD.statusText}`);
                }
                const resultUSD = await resUSD.json();
                const valueUSD = resultUSD.quotes.GBPUSD

                const discountUSD = discountGBP * valueUSD
                const shippingUSD = shippingGBP * valueUSD
                const costUSD = costGBP * valueUSD
                let totalUSD = totalGBP * valueUSD

                const urlEUR = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=GBP&currencies=EUR`;

                const resEUR = await fetch(urlEUR, options)
                if (!resEUR.ok) {
                    throw new Error(`HTTP ${resEUR.status} – ${resEUR.statusText}`);
                }
                const resultEUR = await resEUR.json();
                const valueEUR = resultEUR.quotes.GBPEUR

                const discountEUR = discountGBP * valueEUR
                const shippingEUR = shippingGBP * valueEUR
                const costEUR = costGBP * valueEUR
                let totalEUR = totalGBP * valueEUR

                if (paymentType === 'niftipay') {
                    totalUSD = total
                    totalEUR = total * valueEUR
                    totalGBP = total * valueUSD
                }

                const query = `INSERT INTO "orderRevenue" (id, "orderId", 
                    "USDtotal", "USDdiscount", "USDshipping", "USDcost", 
                    "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
                    "EURtotal", "EURdiscount", "EURshipping", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${id}', 
                    ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
                    ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
                    ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                const resultQuery = await pool.query(query)
                const revenue = resultQuery.rows[0]

                for (const ct of newCategories) {

                    const catRevenueId = uuidv4();

                    const query = `INSERT INTO "categoryRevenue" (id, "categoryId", 
                    "USDtotal", "USDcost", 
                    "GBPtotal", "GBPcost",
                    "EURtotal", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${catRevenueId}', '${ct.categoryId}', 
                    ${(ct.total * valueUSD).toFixed(2)}, ${(ct.cost * valueUSD).toFixed(2)},
                    ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                    ${(ct.total * valueEUR).toFixed(2)}, ${(ct.cost * valueEUR).toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                    await pool.query(query)
                }

                return NextResponse.json(revenue, { status: 200 });

            } else if (euroCountries.includes(country)) {

                const discountEUR = Number(order.discountTotal)
                const shippingEUR = Number(order.shippingTotal)
                const costEUR = totalCost
                let totalEUR = Number(order.totalAmount)

                const urlUSD = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=EUR&currencies=USD`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const resUSD = await fetch(urlUSD, options)
                if (!resUSD.ok) {
                    throw new Error(`HTTP ${resUSD.status} – ${resUSD.statusText}`);
                }
                const resultUSD = await resUSD.json();
                const valueUSD = resultUSD.quotes.EURUSD

                const discountUSD = discountEUR * valueUSD
                const shippingUSD = shippingEUR * valueUSD
                const costUSD = costEUR * valueUSD
                let totalUSD = totalEUR * valueUSD

                const urlGBP = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=EUR&currencies=GBP`;

                const resGBP = await fetch(urlGBP, options)
                if (!resGBP.ok) {
                    throw new Error(`HTTP ${resGBP.status} – ${resGBP.statusText}`);
                }
                const resultGBP = await resGBP.json();
                const valueGBP = resultGBP.quotes.EURGBP

                const discountGBP = discountEUR * valueGBP
                const shippingGBP = shippingEUR * valueGBP
                const costGBP = costEUR * valueGBP
                let totalGBP = totalEUR * valueGBP

                if (paymentType === 'niftipay') {
                    totalUSD = total
                    totalEUR = total * valueUSD
                    totalGBP = total * valueGBP
                }

                const query = `INSERT INTO "orderRevenue" (id, "orderId", 
                    "USDtotal", "USDdiscount", "USDshipping", "USDcost", 
                    "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
                    "EURtotal", "EURdiscount", "EURshipping", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${id}', 
                    ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
                    ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
                    ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                const resultQuery = await pool.query(query)
                const revenue = resultQuery.rows[0]

                for (const ct of newCategories) {

                    const catRevenueId = uuidv4();

                    const query = `INSERT INTO "categoryRevenue" (id, "categoryId", 
                    "USDtotal", "USDcost", 
                    "GBPtotal", "GBPcost",
                    "EURtotal", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${catRevenueId}', '${ct.categoryId}', 
                    ${(ct.total * valueUSD).toFixed(2)}, ${(ct.cost * valueUSD).toFixed(2)},
                    ${(ct.total * valueGBP).toFixed(2)}, ${(ct.cost * valueGBP).toFixed(2)},
                    ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                    await pool.query(query)
                }

                return NextResponse.json(revenue, { status: 200 });
            } else {

                const discountUSD = Number(order.discountTotal)
                const shippingUSD = Number(order.shippingTotal)
                const costUSD = totalCost
                let totalUSD = Number(order.totalAmount)

                const urlEUR = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=USD&currencies=EUR`;
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const resEUR = await fetch(urlEUR, options)
                if (!resEUR.ok) {
                    throw new Error(`HTTP ${resEUR.status} – ${resEUR.statusText}`);
                }
                const resultEUR = await resEUR.json();
                const valueEUR = resultEUR.quotes.USDEUR

                const discountEUR = discountUSD * valueEUR
                const shippingEUR = shippingUSD * valueEUR
                const costEUR = costUSD * valueEUR
                let totalEUR = totalUSD * valueEUR

                const urlGBP = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=USD&currencies=GBP`;

                const resGBP = await fetch(urlGBP, options)
                if (!resGBP.ok) {
                    throw new Error(`HTTP ${resGBP.status} – ${resGBP.statusText}`);
                }
                const resultGBP = await resGBP.json();
                const valueGBP = resultGBP.quotes.USDGBP

                const discountGBP = discountUSD * valueGBP
                const shippingGBP = shippingUSD * valueGBP
                const costGBP = costUSD * valueGBP
                let totalGBP = totalUSD * valueGBP

                if (paymentType === 'niftipay') {
                    totalUSD = total
                    totalEUR = total * valueEUR
                    totalGBP = total * valueGBP
                }

                const query = `INSERT INTO "orderRevenue" (id, "orderId", 
                    "USDtotal", "USDdiscount", "USDshipping", "USDcost", 
                    "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
                    "EURtotal", "EURdiscount", "EURshipping", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${id}', 
                    ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
                    ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
                    ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                const resultQuery = await pool.query(query)
                const revenue = resultQuery.rows[0]

                for (const ct of newCategories) {

                    const catRevenueId = uuidv4();

                    const query = `INSERT INTO "categoryRevenue" (id, "categoryId", 
                    "USDtotal", "USDcost", 
                    "GBPtotal", "GBPcost",
                    "EURtotal", "EURcost",
                    "createdAt", "updatedAt", "organizationId")
                    VALUES ('${catRevenueId}', '${ct.categoryId}', 
                    ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                    ${(ct.total * valueGBP).toFixed(2)}, ${(ct.cost * valueGBP).toFixed(2)},
                    ${(ct.total * valueEUR).toFixed(2)}, ${(ct.cost * valueEUR).toFixed(2)},
                    NOW(), NOW(), '${organizationId}')
                    RETURNING *`

                    await pool.query(query)
                }

                return NextResponse.json(revenue, { status: 200 });
            }
        }

    } catch (error) {
        return NextResponse.json(error, { status: 500 });
    }
}