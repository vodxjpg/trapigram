import { NextRequest, NextResponse } from "next/server";
import { pgPool, pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

// nothing
const apiKey = process.env.CURRENCY_LAYER_API_KEY

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
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx; 

  try {
    const { id } = await params;
    console.log("[orderRevenue] ⇢ start", { id, organizationId });

    const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`
    const resultCheck = await pool.query(checkQuery);
    const check = resultCheck.rows
    console.log("[orderRevenue] existing‑revenue‑rows", check.length);  

    if (check.length === 0) {
      const orderQuery = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`
      const resultOrders = await pool.query(orderQuery);
      const order = resultOrders.rows[0]
      console.log("[orderRevenue] order‑fetched", { id: order?.id, datePaid: order?.datePaid });

      const cartId = order.cartId
      const paymentType = order.paymentMethod
      const country = order.country

      const date = order.datePaid
      const from = Math.floor(date / 1000)
      const to = from + 3600

      const productQuery = `SELECT p.*, cp.quantity
                    FROM "cartProducts" cp
                    JOIN products p ON cp."productId" = p.id
                    WHERE cp."cartId" = '${cartId}'`

      const productResult = await pool.query(productQuery)
      const products = productResult.rows
      console.log("[orderRevenue] products‑in‑cart", products.length);

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
      console.log("[orderRevenue] category‑rows", categoryData.length);

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
        console.log("[orderRevenue] payment=niftipay ‑ using CoinGecko");

        let coin = ""
        let amount = 0
        const paidEntry = order.orderMeta.find(item => item.event === "paid");
        if (paidEntry) {
          coin = paidEntry.order.asset
          amount = paidEntry.order.amount
        }

        const url = `https://api.coingecko.com/api/v3/coins/${coins[coin]}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const options = { method: 'GET', headers: { accept: 'application/json' } };

        const res = await fetch(url, options)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} – ${res.statusText}`);
        }

        const result = await res.json()
        const price = result.prices[0][1]
        total = amount * price
        console.log("[orderRevenue] coin‑conversion", { coin, amount, price, totalUSD: total });
      }

      /**
 * ------------------------------------------------------------------
 * Exchange‑rate lookup with graceful fallback
 * 1. Exact hour window (original behaviour)
 * 2. Most recent rate *before* the order timestamp
 * 3. If still missing, fetch live rate and cache it
 * ------------------------------------------------------------------
 */

      // 1️⃣ Exact window
      let exchangeResult = await pgPool.query(`
   SELECT * FROM "exchangeRate"
   WHERE date BETWEEN to_timestamp(${from})::timestamptz
   AND to_timestamp(${to})::timestamptz
 `);
 console.log("[orderRevenue] exchange‑rows‑exact", exchangeResult.rows.length);
      // 2️⃣ Fallback: latest prior rate
      if (exchangeResult.rows.length === 0) {
        exchangeResult = await pgPool.query(`
     SELECT * FROM "exchangeRate"
     WHERE date <= to_timestamp(${to})::timestamptz
     ORDER BY date DESC
     LIMIT 1
   `);
      }

      let USDEUR = 0;
      let USDGBP = 0;
      console.log("[orderRevenue] exchange‑rows‑prior", exchangeResult.rows.length);
 
      // 3️⃣ Still nothing – pull live rate
      if (exchangeResult.rows.length === 0) {
        const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
        const res = await fetch(url);
        const data = await res.json();

        const usdEur = data.quotes?.USDEUR;
        const usdGbp = data.quotes?.USDGBP;
        if (usdEur == null || usdGbp == null) {
          return NextResponse.json({ error: "Invalid CurrencyLayer response" }, { status: 502 });
        }

        const { rows } = await pgPool.query(`
     INSERT INTO "exchangeRate"("EUR", "GBP", date)
        VALUES(${usdEur}, ${usdGbp}, NOW())
        RETURNING *
          `);
        USDEUR = rows[0].EUR;
        USDGBP = rows[0].GBP;
      } else {
        const row = exchangeResult.rows[0];
        USDEUR = row.EUR;
        USDGBP = row.GBP;
      } 
      console.log("[orderRevenue] final‑rates", { USDEUR, USDGBP });
 
      const revenueId = uuidv4();
      console.log("[orderRevenue] revenueId", revenueId);
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

        if (paymentType === 'niftipay') {
          totalUSD = total
          totalEUR = total * USDEUR
          totalGBP = total * USDEUR
        }
        console.log("[orderRevenue] inserting orderRevenue for", country);
        const query = `INSERT INTO "orderRevenue"(id, "orderId",
            "USDtotal", "USDdiscount", "USDshipping", "USDcost",
            "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
            "EURtotal", "EURdiscount", "EURshipping", "EURcost",
            "createdAt", "updatedAt", "organizationId")
        VALUES('${revenueId}', '${id}',
          ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
          NOW(), NOW(), '${organizationId}')
        RETURNING * `

        const resultQuery = await pool.query(query)
        const revenue = resultQuery.rows[0]

        for (const ct of newCategories) {

          const catRevenueId = uuidv4();

          const query = `INSERT INTO "categoryRevenue"(id, "categoryId",
          "USDtotal", "USDcost",
          "GBPtotal", "GBPcost",
          "EURtotal", "EURcost",
          "createdAt", "updatedAt", "organizationId")
        VALUES('${catRevenueId}', '${ct.categoryId}',
          ${(ct.total / USDGBP).toFixed(2)}, ${(ct.cost / USDGBP).toFixed(2)},
                    ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
                    ${(ct.total * (USDEUR / USDGBP)).toFixed(2)}, ${(ct.cost * (USDEUR / USDGBP)).toFixed(2)},
      NOW(), NOW(), '${organizationId}')
      RETURNING * `

          await pool.query(query)
        }

        return NextResponse.json(revenue, { status: 200 });

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

        if (paymentType === 'niftipay') {
          totalUSD = total
          totalEUR = total * USDEUR
          totalGBP = total * USDGBP
        }

        const query = `INSERT INTO "orderRevenue"(id, "orderId",
        "USDtotal", "USDdiscount", "USDshipping", "USDcost",
        "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
        "EURtotal", "EURdiscount", "EURshipping", "EURcost",
        "createdAt", "updatedAt", "organizationId")
      VALUES('${revenueId}', '${id}',
        ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
        ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
        ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
        NOW(), NOW(), '${organizationId}')
      RETURNING * `

        const resultQuery = await pool.query(query)
        const revenue = resultQuery.rows[0]

        for (const ct of newCategories) {

          const catRevenueId = uuidv4();

          const query = `INSERT INTO "categoryRevenue"(id, "categoryId",
        "USDtotal", "USDcost",
        "GBPtotal", "GBPcost",
        "EURtotal", "EURcost",
        "createdAt", "updatedAt", "organizationId")
      VALUES('${catRevenueId}', '${ct.categoryId}',
        ${(ct.total / USDEUR).toFixed(2)}, ${(ct.cost / USDEUR).toFixed(2)},
                    ${(ct.total * (USDGBP / USDEUR)).toFixed(2)}, ${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
                    ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
    NOW(), NOW(), '${organizationId}')
    RETURNING * `

          await pool.query(query)
          console.log("[orderRevenue] categoryRevenue inserted", catRevenueId);
        }
        console.log("[orderRevenue] success");
        return NextResponse.json(revenue, { status: 200 });
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

        if (paymentType === 'niftipay') {
          totalUSD = total
          totalEUR = total * USDEUR
          totalGBP = total * USDGBP
        }

        const query = `INSERT INTO "orderRevenue"(id, "orderId",
      "USDtotal", "USDdiscount", "USDshipping", "USDcost",
      "GBPtotal", "GBPdiscount", "GBPshipping", "GBPcost",
      "EURtotal", "EURdiscount", "EURshipping", "EURcost",
      "createdAt", "updatedAt", "organizationId")
    VALUES('${revenueId}', '${id}',
      ${totalUSD.toFixed(2)}, ${discountUSD.toFixed(2)}, ${shippingUSD.toFixed(2)}, ${costUSD.toFixed(2)},
      ${totalGBP.toFixed(2)}, ${discountGBP.toFixed(2)}, ${shippingGBP.toFixed(2)}, ${costGBP.toFixed(2)},
      ${totalEUR.toFixed(2)}, ${discountEUR.toFixed(2)}, ${shippingEUR.toFixed(2)}, ${costEUR.toFixed(2)},
      NOW(), NOW(), '${organizationId}')
    RETURNING * `

        const resultQuery = await pool.query(query)
        const revenue = resultQuery.rows[0]

        for (const ct of newCategories) {

          const catRevenueId = uuidv4();

          const query = `INSERT INTO "categoryRevenue"(id, "categoryId",
      "USDtotal", "USDcost",
      "GBPtotal", "GBPcost",
      "EURtotal", "EURcost",
      "createdAt", "updatedAt", "organizationId")
    VALUES('${catRevenueId}', '${ct.categoryId}',
      ${ct.total.toFixed(2)}, ${ct.cost.toFixed(2)},
      ${(ct.total * USDGBP).toFixed(2)}, ${(ct.cost * USDGBP).toFixed(2)},
                    ${(ct.total * USDEUR).toFixed(2)}, ${(ct.cost * USDEUR).toFixed(2)},
  NOW(), NOW(), '${organizationId}')
  RETURNING * `

          await pool.query(query)
        }
        return NextResponse.json(revenue, { status: 200 });
      }
    }

  } catch (error) {
    console.error("[orderRevenue] ERROR", error);
    return NextResponse.json(error, { status: 500 });
  }
}