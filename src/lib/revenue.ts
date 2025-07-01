import { pgPool as pool } from "@/lib/db";;
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

const apiKey = '144659c7b175794ed4eae9bacf853944'

export async function getRevenue(orderId, organizationId) {
    const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${orderId}'`
    const resultCheck = await pool.query(checkQuery);
    const check = resultCheck.rows

    if (check.length === 0) {
        const orderQuery = `SELECT * FROM orders WHERE id = '${orderId}' AND "organizationId" = '${organizationId}'`
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

        const totalCost = products.reduce((sum, product) => {
            return sum + ((product.cost[country] * product.quantity) || 0);
        }, 0);

        let total = 0
        let value = 0

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
            console.log(country)
            const url = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=GBP&currencies=USD`;
            const options = { method: 'GET', headers: { accept: 'application/json' } };

            const res = await fetch(url, options)
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} – ${res.statusText}`);
            }
            const result = await res.json();
            value = result.quotes.GBPUSD

            const discount = order.discountTotal * value
            const shipping = order.shippingTotal * value
            const cost = totalCost * value

            if (paymentType !== 'niftipay') {
                total = order.totalAmount * value
            }

            const query = `INSERT INTO "orderRevenue" (id, "orderId", total, discount, shipping, cost, "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${orderId}', ${total.toFixed(2)}, ${discount.toFixed(2)}, ${shipping.toFixed(2)}, ${cost.toFixed(2)}, NOW(), NOW(), '${organizationId}')
                    RETURNING *`

            const resultQuery = await pool.query(query)
            const revenue = resultQuery.rows[0]

            return revenue
        } else if (euroCountries.includes(country)) {

            const url = `https://api.currencylayer.com/historical?access_key=${apiKey}&date=${dateString}&source=EUR&currencies=USD`;
            const options = { method: 'GET', headers: { accept: 'application/json' } };

            const res = await fetch(url, options)
            if (!res.ok) {
                throw new Error(`HTTP ${res.status} – ${res.statusText}`);
            }
            const result = await res.json();
            value = result.quotes.EURUSD

            const discount = order.discountTotal * value
            const shipping = order.shippingTotal * value
            const cost = totalCost * value

            if (paymentType !== 'niftipay') {
                total = order.totalAmount * value
            }

            const query = `INSERT INTO "orderRevenue" (id, "orderId", total, discount, shipping, cost, "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${orderId}', ${total.toFixed(2)}, ${discount.toFixed(2)}, ${shipping.toFixed(2)}, ${cost.toFixed(2)}, NOW(), NOW(), '${organizationId}')
                    RETURNING *`

            const resultQuery = await pool.query(query)
            const revenue = resultQuery.rows[0]

            return revenue
        } else {

            const discount = Number(order.discountTotal)
            const shipping = Number(order.shippingTotal)
            const cost = Number(totalCost)

            if (paymentType !== 'niftipay') {
                total = Number(order.totalAmount)
            }
            console.log(total)

            const query = `INSERT INTO "orderRevenue" (id, "orderId", total, discount, shipping, cost, "createdAt", "updatedAt", "organizationId")
                    VALUES ('${revenueId}', '${orderId}', ${total.toFixed(2)}, ${discount.toFixed(2)}, ${shipping.toFixed(2)}, ${cost.toFixed(2)}, NOW(), NOW(), '${organizationId}')
                    RETURNING *`

            const resultQuery = await pool.query(query)
            const revenue = resultQuery.rows[0]

            return revenue
        }
    }
}