import { pgPool, pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

// nothing

const apiKey = process.env.CURRENCY_LAYER_API_KEY

// ── diagnostics ──────────────────────────────────────────────
const dbg  = (...a: any[]) => console.log("[orderRevenue]", ...a);
if (!process.env.CURRENCY_LAYER_API_KEY)
  console.warn("[orderRevenue] ⚠️  CURRENCY_LAYER_API_KEY is not set");

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

const coins: Record<string, string> = {
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

export async function getRevenue(id: string, organizationId: string) {
    try {
        const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`
        const resultCheck = await pool.query(checkQuery);
        const check = resultCheck.rows
        console.log(check)

        if (check.length > 0) {
            console.log("[orderRevenue] revenue‑already‑exists", {
                orderId: id,
                rows: check.length,
            });
            return check[0]
        }

        if (check.length === 0) {
            const orderQuery = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`
            const resultOrders = await pool.query(orderQuery);
            const order = resultOrders.rows[0]
            console.log(order)

            const cartId = order.cartId
            const paymentType = order.paymentMethod
            const country = order.country

            // --- after you've fetched `order` from the DB ---
            const raw = order.datePaid;   // string or Date
            const paidDate = raw instanceof Date
                ? raw
                : new Date(raw);
            console.log(raw)
            console.log(paidDate)                     // ensure it's a JS Date

            // now get seconds since the Unix epoch
            const to = Math.floor(paidDate.getTime() / 1000);
            const from = to - 3600;
            console.log(to)
            console.log(from)

            const productQuery = `SELECT p.*, cp.quantity
                    FROM "cartProducts" cp
                    JOIN products p ON cp."productId" = p.id
                    WHERE cp."cartId" = '${cartId}'`
            const productResult = await pool.query(productQuery)
            const products = productResult.rows

            const categoryQuery = `SELECT cp.*, p.*, pc."categoryId" FROM "cartProducts" AS cp
                JOIN "products" AS p ON cp."productId" = p."id"
                LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
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
            console.log(paymentType.toLowerCase())
            if (paymentType.toLowerCase() == 'niftipay') {
                let coinRaw = ""
                let amount = 0
                const paidEntry = order.orderMeta.find(item => item.event === "paid");
                if (paidEntry) {
                    coinRaw = paidEntry.order.asset ?? ""
                    amount = paidEntry.order.amount
                }

                const coinKey = coinRaw.toUpperCase();
                const coinId  = coins[coinKey];
                if (!coinId) {
                    console.warn("[orderRevenue] ⚠️ unsupported asset:", coinKey);
                    throw new Error(`Unsupported crypto asset "${coinKey}"`);
                }
                const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
                console.log("CoinGecko →", url)
                const options = { method: 'GET', headers: { accept: 'application/json' } };

                const res = await fetch(url, options)
                dbg("CoinGecko ←", res.status, res.statusText)
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status} – ${res.statusText}`);
                }

                const result = await res.json()
                const price = result.prices[0][1]
                total = amount * price

                const exchangeQuery = `SELECT * FROM "exchangeRate" WHERE date BETWEEN to_timestamp(${from}) AND to_timestamp(${to})`
                const exchangeResult = await pgPool.query(exchangeQuery)
                console.log(exchangeResult.rows)

                let USDEUR = 0
                let USDGBP = 0
                if (exchangeResult.rows.length === 0) {
                    const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
                    dbg("CurrencyLayer →", url)
                    const res = await fetch(url);
                    dbg("CurrencyLayer ←", res.status, res.statusText)
                    const data = await res.json();

                    const usdEur = data.quotes?.USDEUR;
                    const usdGbp = data.quotes?.USDGBP;
                    if (usdEur == null || usdGbp == null) {
                        return { error: 'Invalid API response' }
                    }
                    const insertSql = `
                        INSERT INTO "exchangeRate" ("EUR","GBP", date)
                        VALUES ($1, $2, $3)
                        RETURNING *`;
                    const values = [usdEur, usdGbp, new Date(paidDate)]
                    const response = await pgPool.query(insertSql, values);
                    const result = response.rows[0]

                    USDEUR = result.EUR
                    USDGBP = result.GBP
                } else {
                    const result = exchangeResult.rows[0]
                    USDEUR = result.EUR
                    USDGBP = result.GBP
                }

                const revenueId = uuidv4();

                if (country === 'GB') {
                    const discountGBP = Number(order.discountTotal)
                    const shippingGBP = Number(order.shippingTotal)
                    const costGBP = totalCost
                    let totalGBP = Number(order.totalAmount)

                    const discountUSD = discountGBP / USDGBP
                    const shippingUSD = shippingGBP / USDGBP
                    const costUSD = costGBP / USDGBP
                    let totalUSD = totalGBP / USDGBP

                    const discountEUR = discountGBP * (USDEUR / USDGBP)
                    const shippingEUR = shippingGBP * (USDEUR / USDGBP)
                    const costEUR = costGBP * (USDEUR / USDGBP)
                    let totalEUR = totalGBP * (USDEUR / USDGBP)

                    if (paymentType.toLowerCase() == 'niftipay') {
                        totalUSD = total
                        totalEUR = total * USDEUR
                        totalGBP = total * USDEUR
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
                            ${(ct.total / USDGBP).toFixed(2)}, ${(ct.cost / USDGBP).toFixed(2)},
                            ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                            ${(ct.total * (USDEUR / USDGBP)).toFixed(2)}, ${(ct.cost * (USDEUR / USDGBP)).toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue;
                } else if (euroCountries.includes(country)) {
                    const discountEUR = Number(order.discountTotal)
                    const shippingEUR = Number(order.shippingTotal)
                    const costEUR = totalCost
                    let totalEUR = Number(order.totalAmount)

                    const discountUSD = discountEUR / USDEUR
                    const shippingUSD = shippingEUR / USDEUR
                    const costUSD = costEUR / USDEUR
                    let totalUSD = totalEUR / USDEUR

                    const discountGBP = discountEUR * (USDGBP / USDEUR)
                    const shippingGBP = shippingEUR * (USDGBP / USDEUR)
                    const costGBP = costEUR * (USDGBP / USDEUR)
                    let totalGBP = totalEUR * (USDGBP / USDEUR)

                    if (paymentType.toLowerCase() == 'niftipay') {
                        totalUSD = total
                        totalEUR = total * USDEUR
                        totalGBP = total * USDGBP
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
                            ${(ct.total / USDEUR).toFixed(2)}, ${(ct.cost / USDEUR).toFixed(2)},
                            ${(ct.total * (USDGBP / USDEUR)).toFixed(2)}, ${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
                            ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue
                } else {
                    const discountUSD = Number(order.discountTotal)
                    const shippingUSD = Number(order.shippingTotal)
                    const costUSD = totalCost
                    let totalUSD = Number(order.totalAmount)

                    const discountEUR = discountUSD * USDEUR
                    const shippingEUR = shippingUSD * USDEUR
                    const costEUR = costUSD * USDEUR
                    let totalEUR = totalUSD * USDEUR

                    const discountGBP = discountUSD * USDGBP
                    const shippingGBP = shippingUSD * USDGBP
                    const costGBP = costUSD * USDGBP
                    let totalGBP = totalUSD * USDGBP

                    if (paymentType.toLowerCase() == 'niftipay') {
                        totalUSD = total
                        totalEUR = total * USDEUR
                        totalGBP = total * USDGBP
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
                            ${(ct.total * USDGBP).toFixed(2)}, ${(ct.cost * USDGBP).toFixed(2)},
                            ${(ct.total * USDEUR).toFixed(2)}, ${(ct.cost * USDEUR).toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue
                }
            } else { //some changes
                const exchangeQuery = `SELECT * FROM "exchangeRate" WHERE date BETWEEN to_timestamp(${from}) AND to_timestamp(${to})`
                const exchangeResult = await pgPool.query(exchangeQuery)

                let USDEUR = 0
                let USDGBP = 0
                if (exchangeResult.rows.length === 0) {
                    const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
                    const res = await fetch(url);
                    dbg("CurrencyLayer ←", res.status, res.statusText)
                    const data = await res.json();

                    const usdEur = data.quotes?.USDEUR;
                    const usdGbp = data.quotes?.USDGBP;
                    if (usdEur == null || usdGbp == null) {
                        return { error: 'Invalid API response' }
                    }

                    const insertSql = `
                        INSERT INTO "exchangeRate" ("EUR","GBP", date)
                        VALUES ($1, $2, $3)
                        RETURNING *`;
                    const values = [usdEur, usdGbp, new Date(paidDate)]
                    const response = await pgPool.query(insertSql, values);
                    const result = response.rows[0]

                    USDEUR = result.EUR
                    USDGBP = result.GBP
                } else {
                    const result = exchangeResult.rows[0]
                    USDEUR = result.EUR
                    USDGBP = result.GBP
                }

                const revenueId = uuidv4();

                if (country === 'GB') {
                    const totalGBP = Number(order.totalAmount)
                    const shippingGBP = Number(order.shippingTotal)
                    const discountGBP = Number(order.discountTotal)
                    const costGBP = totalCost

                    const discountUSD = discountGBP / USDGBP
                    const shippingUSD = shippingGBP / USDGBP
                    const costUSD = costGBP / USDGBP
                    const totalUSD = totalGBP / USDGBP

                    const discountEUR = discountGBP * (USDEUR / USDGBP)
                    const shippingEUR = shippingGBP * (USDEUR / USDGBP)
                    const costEUR = costGBP * (USDEUR / USDGBP)
                    const totalEUR = totalGBP * (USDEUR / USDGBP)

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
                            ${(ct.total / USDGBP).toFixed(2)}, ${(ct.cost / USDGBP).toFixed(2)},
                            ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                            ${(ct.total * (USDEUR / USDGBP)).toFixed(2)}, ${(ct.cost * (USDEUR / USDGBP)).toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue;
                } else if (euroCountries.includes(country)) {
                    const totalEUR = Number(order.totalAmount)
                    const shippingEUR = Number(order.shippingTotal)
                    const discountEUR = Number(order.discountTotal)
                    const costEUR = totalCost

                    const discountGBP = discountEUR * (USDGBP / USDEUR)
                    const shippingGBP = shippingEUR * (USDGBP / USDEUR)
                    const costGBP = costEUR * (USDGBP / USDEUR)
                    const totalGBP = totalEUR * (USDGBP / USDEUR)

                    const discountUSD = discountEUR / USDEUR
                    const shippingUSD = shippingEUR / USDEUR
                    const costUSD = costEUR / USDEUR
                    const totalUSD = totalEUR / USDEUR

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
                            ${(ct.total / USDEUR).toFixed(2)}, ${(ct.cost / USDEUR).toFixed(2)},
                            ${(ct.total * (USDGBP / USDEUR)).toFixed(2)}, ${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
                            ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue
                } else {
                    const discountUSD = Number(order.discountTotal)
                    const shippingUSD = Number(order.shippingTotal)
                    const totalUSD = Number(order.totalAmount)
                    const costUSD = totalCost

                    const discountEUR = discountUSD * USDEUR
                    const shippingEUR = shippingUSD * USDEUR
                    const costEUR = costUSD * USDEUR
                    const totalEUR = totalUSD * USDEUR

                    const discountGBP = discountUSD * USDGBP
                    const shippingGBP = shippingUSD * USDGBP
                    const costGBP = costUSD * USDGBP
                    const totalGBP = totalUSD * USDGBP

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
                            ${(ct.total * USDGBP).toFixed(2)}, ${(ct.cost * USDGBP).toFixed(2)},
                            ${(ct.total * USDEUR).toFixed(2)}, ${(ct.cost * USDEUR).toFixed(2)},
                            NOW(), NOW(), '${organizationId}')
                            RETURNING *`

                        await pool.query(query)
                    }
                    return revenue
                }
            }
        }
    } catch (error) {
        return error
    }
}