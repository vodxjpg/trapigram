// src/app/api/order/[id]/change-status/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import type { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { sendNotification } from "@/lib/notifications";
import { createHmac } from "crypto";
import type { NotificationType } from "@/lib/notifications";

// Vercel runtime hints (keep these AFTER all imports)
export const runtime = "nodejs";
export const preferredRegion = ["iad1"];


// ── diagnostics ──────────────────────────────────────────────

const apiKey = process.env.CURRENCY_LAYER_API_KEY
const dbg = (...a: any[]) => console.log("[orderRevenue]", ...a);
if (!apiKey) console.warn("[orderRevenue] ⚠️  CURRENCY_LAYER_API_KEY is not set");

//------------- Order Revenue---------------------//


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

async function getRevenue(id: string, organizationId: string) {
  try {
    const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = $1`;
    const resultCheck = await pool.query(checkQuery, [id]);
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
      const orderQuery = `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2`;
      const resultOrders = await pool.query(orderQuery, [id, organizationId]);
      const order = resultOrders.rows[0]
      console.log(order)

      const cartId = order.cartId
      const paymentType = (order.paymentMethod ?? "").toLowerCase();
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
                             WHERE cp."cartId" = $1`;
      const productResult = await pool.query(productQuery, [cartId]);
      const products = productResult.rows

      const affiliateQuery = `SELECT p.*, cp.quantity
                    FROM "cartProducts" cp
                    JOIN "affiliateProducts" p ON cp."affiliateProductId" = p.id
                    WHERE cp."cartId" = '${cartId}'`
      const affiliateResult = await pool.query(affiliateQuery)
      const affiliate = affiliateResult.rows

      const allProducts = products.concat(affiliate)
      console.log(allProducts)

      const categoryQuery = `SELECT cp.*, p.*, pc."categoryId"
                               FROM "cartProducts" AS cp
                               JOIN "products" AS p ON cp."productId" = p."id"
                          LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
                              WHERE cp."cartId" = $1`;
      const categoryResult = await pool.query(categoryQuery, [cartId]);
      const categoryData = categoryResult.rows

      const categories: CategoryRevenue[] = [];

      for (const ct of categoryData) {
        categories.push({
          categoryId: ct.categoryId,
          // Use the actual charged line price (cp.unitPrice), not the product's retail price
          price: Number(ct.unitPrice),
          cost: ct.cost[country],
          quantity: ct.quantity
        })
      }

      const newCategories: TransformedCategoryRevenue[] = categories.map(({ categoryId, price, cost, quantity }) => ({
        categoryId,
        total: price * quantity,
        cost: cost * quantity,
      }));

      const totalCost = allProducts.reduce((sum, product) => {
        return sum + ((product.cost[country] * product.quantity) || 0);
      }, 0);

      let total = 0
      console.log(paymentType)
      if (paymentType === 'niftipay') {
        let coinRaw = ""
        let amount = 0
        const meta = Array.isArray(order.orderMeta) ? order.orderMeta : JSON.parse(order.orderMeta ?? "[]");
        const paidEntry = meta.find((item: any) => (item.event ?? "").toLowerCase() === "paid");
        if (paidEntry) {
          coinRaw = paidEntry.order.asset ?? ""
          amount = paidEntry.order.amount
        }

        const coinKey = coinRaw.toUpperCase();
        const coinId = coins[coinKey];
        if (!coinId) {
          dbg("⚠️ unsupported asset:", coinKey);
          throw new Error(`Unsupported crypto asset "${coinKey}"`);
        }
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        dbg("CoinGecko →", url)
        const options = { method: 'GET', headers: { accept: 'application/json' } };

        const res = await fetch(url, options)
        dbg("CoinGecko ←", res.status, res.statusText)
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} – ${res.statusText}`);
        }

        const result = await res.json();
        const prices = Array.isArray(result?.prices) ? result.prices : [];
        const price = prices.length ? prices[prices.length - 1][1] : null; // use latest data point
        if (price == null) {
          throw new Error("No price data from CoinGecko");
        }
        total = amount * price

        const exchangeQuery = `
          SELECT "EUR","GBP" FROM "exchangeRate"
           WHERE date <= to_timestamp($1) ORDER BY date DESC LIMIT 1`;
        const exchangeResult = await pool.query(exchangeQuery, [to])
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
          const response = await pool.query(insertSql, values);
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

          if (paymentType === 'niftipay') {
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

          if (paymentType === 'niftipay') {
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

          if (paymentType === 'niftipay') {
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
        // NOTE: exchange rate lookup narrowed to the single nearest row at/just before paid date
        // and parameterized to avoid SQL injection.
        const exchangeQuery = `
          SELECT "EUR","GBP" FROM "exchangeRate"
           WHERE date <= to_timestamp($1) ORDER BY date DESC LIMIT 1`;
        const exchangeResult = await pool.query(exchangeQuery, [to])

        let USDEUR = 0
        let USDGBP = 0
        if (exchangeResult.rows.length === 0) {
          const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
          const res = await fetch(url);
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
          const response = await pool.query(insertSql, values);
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

/* ───────── helpers ───────── */
/** Stock & points stay RESERVED while the order is *underpaid*. */
const ACTIVE = ["open", "underpaid", "paid", "completed"]; // stock & points RESERVED
const INACTIVE = ["cancelled", "failed", "refunded"];      // stock & points RELEASED
const orderStatusSchema = z.object({ status: z.string() });
/* record-the-date helper */
const DATE_COL_FOR_STATUS: Record<string, string | undefined> = {
  underpaid: "dateUnderpaid",
  paid: "datePaid",
  completed: "dateCompleted",
  cancelled: "dateCancelled",
  refunded: "dateCancelled",   // choose whatever fits your flow
};
/**
 * Statuses that should trigger exactly one notification per order
 * life-cycle – “paid” & “completed“ behave as before.
 * “cancelled” is always announced.
 */
const FIRST_NOTIFY_STATUSES = ["paid", "completed"] as const
const isActive = (s: string) => ACTIVE.includes(s);
const isInactive = (s: string) => INACTIVE.includes(s);


/* util: build {product_list} for a given cart (normal  affiliate, grouped) */
async function buildProductListForCart(cartId: string) {
  const { rows } = await pool.query(
    `
      SELECT
        cp.quantity,
        COALESCE(p.title, ap.title)                             AS title,
        COALESCE(cat.name, 'Uncategorised')                     AS category
      FROM "cartProducts" cp
      LEFT JOIN products p              ON p.id  = cp."productId"
      LEFT JOIN "affiliateProducts" ap  ON ap.id = cp."affiliateProductId"
      LEFT JOIN "productCategory" pc    ON pc."productId" = COALESCE(p.id, ap.id)
      LEFT JOIN "productCategories" cat ON cat.id = pc."categoryId"
      WHERE cp."cartId" = $1
      ORDER BY category, title
    `,
    [cartId],
  );
  const grouped: Record<string, { q: number; t: string }[]> = {};
  for (const r of rows) {
    grouped[r.category] ??= [];
    grouped[r.category].push({ q: r.quantity, t: r.title });
  }
  return Object.entries(grouped)
    .map(([cat, items]) => {
      const lines = items.map((it) => `${it.t} - x${it.q}`).join("<br>");
      return `<b>${cat.toUpperCase()}</b><br><br>${lines}`;
    })
    .join("<br><br>");
}

/* Create supplier orders (S-<orderKey>) for mapped items if missing */
async function ensureSupplierOrdersExist(baseOrderId: string) {
  // fetch the buyer order fresh (we’ll need org, cart, country, key)
  const { rows: [o] } = await pool.query(
    `SELECT id,"organizationId","clientId","cartId",country,"orderKey","paymentMethod",
            "shippingService","shippingMethod","address",status,
            "shippingTotal","pointsRedeemed","pointsRedeemedAmount"
       FROM orders WHERE id = $1`, [baseOrderId]);
  if (!o) return;
  const baseKey: string = String(o.orderKey || "").replace(/^S-/, "");
  // already have supplier siblings?
  const { rowCount: sibs } = await pool.query(
    `SELECT 1 FROM orders WHERE "orderKey" = ('S-' || $1) LIMIT 1`, [baseKey]);
  if (sibs) return; // nothing to do

  // build mapping of target(B) -> source(A) by organization
  const { rows: cpRows } = await pool.query(
    `SELECT "productId",quantity,"affiliateProductId","unitPrice"
       FROM "cartProducts" WHERE "cartId" = $1`, [o.cartId]);
  if (!cpRows.length) return;

  type MapItem = { organizationId: string; shareLinkId: string; sourceProductId: string; targetProductId: string; };
  const map: MapItem[] = [];
  for (const ln of cpRows) {
    if (!ln.productId) continue;
    const { rows: [m] } = await pool.query(
      `SELECT "shareLinkId","sourceProductId","targetProductId"
         FROM "sharedProductMapping" WHERE "targetProductId" = $1 LIMIT 1`,
      [ln.productId]);
    if (!m) continue;
    const { rows: [prod] } = await pool.query(
      `SELECT "organizationId" FROM products WHERE id = $1`, [m.sourceProductId]);
    if (!prod) continue;
    map.push({ organizationId: prod.organizationId, ...m });
  }
  if (!map.length) return;

  const groups: Record<string, MapItem[]> = {};
  for (const it of map) (groups[it.organizationId] ??= []).push(it);
  const entries = Object.entries(groups);

  // precompute transfer subtotals for shipping split
  const transferSubtotals: Record<string, number> = {};
  for (const [orgId, items] of entries) {
    let sum = 0;
    for (const it of items) {
      const { rows: [ln] } = await pool.query(
        `SELECT quantity FROM "cartProducts" WHERE "cartId" = $1 AND "productId" = $2 LIMIT 1`,
        [o.cartId, it.targetProductId]);
      const qty = Number(ln?.quantity || 0);
      const { rows: [sp] } = await pool.query(
        `SELECT cost FROM "sharedProduct" WHERE "shareLinkId" = $1 AND "productId" = $2 LIMIT 1`,
        [it.shareLinkId, it.sourceProductId]);
      const transfer = Number(sp?.cost?.[o.country] ?? 0);
      sum += transfer * qty;
    }
    transferSubtotals[orgId] = sum;
  }
  const buyerShipping = Number(o.shippingTotal || 0);
  const totalTransfer = Object.values(transferSubtotals).reduce((a, b) => a + b, 0) || 0;
  let shippingAssigned = 0;

  for (let i = 0; i < entries.length; i++) {
    const [orgId, items] = entries[i];
    // ensure client exists in supplier org
    const { rows: [oldClient] } = await pool.query(`SELECT * FROM clients WHERE id = $1`, [o.clientId]);
    const { rows: [found] } = await pool.query(
      `SELECT id FROM clients WHERE "userId" = $1 AND "organizationId" = $2 LIMIT 1`,
      [oldClient.userId, orgId]);
    const supplierClientId = found?.id ?? uuidv4();
    if (!found) {
      await pool.query(
        `INSERT INTO clients (id,"userId","organizationId",username,"firstName","lastName",email,"phoneNumber",country,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
        [supplierClientId, oldClient.userId, orgId, oldClient.username, oldClient.firstName, oldClient.lastName, oldClient.email, oldClient.phoneNumber, oldClient.country],
      );
    }
    // create supplier cart
    const supplierCartId = uuidv4();
    const supplierCartHash = createHmac("sha256", "cart").update(supplierCartId).digest("hex");
    await pool.query(
      `INSERT INTO carts (id,"clientId",country,"shippingMethod",status,"organizationId","cartHash","cartUpdatedHash","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7,NOW(),NOW())`,
      [supplierCartId, supplierClientId, o.country, o.shippingMethod, false, orgId, supplierCartHash],
    );
    // add items at transfer price
    let subtotal = 0;
    for (const it of items) {
      const { rows: [ln] } = await pool.query(
        `SELECT quantity,"affiliateProductId" FROM "cartProducts" WHERE "cartId" = $1 AND "productId" = $2 LIMIT 1`,
        [o.cartId, it.targetProductId]);
      const qty = Number(ln?.quantity || 0);
      const affId = ln?.affiliateProductId || null;
      const { rows: [sp] } = await pool.query(
        `SELECT cost FROM "sharedProduct" WHERE "shareLinkId" = $1 AND "productId" = $2 LIMIT 1`,
        [it.shareLinkId, it.sourceProductId]);
      const transfer = Number(sp?.cost?.[o.country] ?? 0);
      if (qty > 0) {
        await pool.query(
          `INSERT INTO "cartProducts" (id,"cartId","productId","quantity","unitPrice","affiliateProductId")
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), supplierCartId, it.sourceProductId, qty, transfer, affId],
        );
        subtotal += transfer * qty;
      }
    }
    // shipping split
    let shippingShare = 0;
    if (totalTransfer > 0) {
      if (i === entries.length - 1) shippingShare = buyerShipping - shippingAssigned;
      else {
        shippingShare = Number(((buyerShipping * (transferSubtotals[orgId] || 0)) / totalTransfer).toFixed(2));
        shippingAssigned += shippingShare;
      }
    }
    // create supplier order S-<orderKey>
    const supplierOrderId = uuidv4();
     await pool.query(
   `INSERT INTO orders
 (id,"organizationId","clientId","cartId",country,"paymentMethod",
  "shippingTotal","totalAmount","shippingService","shippingMethod",
  address,status,subtotal,"pointsRedeemed","pointsRedeemedAmount",
  "dateCreated","createdAt","updatedAt","orderKey","discountTotal","cartHash","orderMeta")
VALUES
 ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW(),NOW(),$16,$17,$18,'[]'::jsonb)`,
   [
     supplierOrderId, orgId, supplierClientId, supplierCartId, o.country, o.paymentMethod,
     shippingShare, shippingShare + subtotal, o.shippingService, o.shippingMethod,
     o.address, o.status, subtotal, o.pointsRedeemed, o.pointsRedeemedAmount,
     `S-${baseKey}`, 0, supplierCartHash,  // ← non-null hash
   ],
 );

    console.log("[ensureSupplierOrders] created S-order", { supplierOrderId, key: `S-${baseKey}`, orgId, subtotal, shippingShare });
  }
}

/* ——— stock / points helper (unchanged) ——— */
async function applyItemEffects(
  c: Pool,
  effectSign: 1 | -1,              // +1 refund  |  -1 charge
  country: string,
  organizationId: string,
  clientId: string,
  item: {
    productId: string | null;
    affiliateProductId: string | null;
    quantity: number;
    unitPrice: number;
  },
  actionForLog: string,
  descrForLog: string,
) {
  /* stock --------------------------------------------------------- */
  if (item.productId)
    await adjustStock(c, item.productId, country, effectSign * item.quantity);
  if (item.affiliateProductId)
    await adjustStock(
      c,
      item.affiliateProductId,
      country,
      effectSign * item.quantity,
    );

  /* points -------------------------------------------------------- */
  if (item.affiliateProductId) {
    const pts = item.unitPrice * item.quantity * effectSign; // charge = −, refund = +
    const logId = uuidv4();
    await c.query(
      `INSERT INTO "affiliatePointLogs"
         (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
       VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
      [logId, organizationId, clientId, pts, actionForLog, descrForLog],
    );

    const deltaCurrent = pts;  // same sign as pts
    const deltaSpent = -pts;  // opposite sign
    await c.query(
      `INSERT INTO "affiliatePointBalances"
         ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
       VALUES($1,$2,$3,$4,NOW(),NOW())
       ON CONFLICT("clientId","organizationId") DO UPDATE
         SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
             "pointsSpent"   = GREATEST(
                                 "affiliatePointBalances"."pointsSpent" + EXCLUDED."pointsSpent",
                                 0
                               ),
             "updatedAt"     = NOW()`,
      [clientId, organizationId, deltaCurrent, deltaSpent],
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // 1) context  permission guard (supports internal cron calls)
  const { id } = params;
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;
  let tenantId: string | null = null;

  if (internalSecret && internalSecret === process.env.INTERNAL_API_SECRET) {
    // Called by Vercel Cron: derive org from the order (no user session)
    const { rows: [o] } = await pool.query(
      `SELECT "organizationId" FROM orders WHERE id = $1 LIMIT 1`,
      [id],
    );
    if (!o) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    organizationId = o.organizationId;
    // tenantId left null; Niftipay sync block already guards on falsy tenantId
  } else {
    // Normal authenticated path
    const ctx = await getContext(req) as { organizationId: string; tenantId: string | null };
    organizationId = ctx.organizationId;
    tenantId = ctx.tenantId ?? null;
  }
  const { status: newStatus } = orderStatusSchema.parse(await req.json());

  const client = await pool.connect();
  const toastWarnings: string[] = [];
  let txOpen = false, released = false;
  try {
    await client.query("BEGIN"); txOpen = true;

    /* 1️⃣ lock order row */
    const {
      rows: [ord],
    } = await client.query(
      `SELECT status,
              "paymentMethod",
              country,
              "trackingNumber",
              "cartId",
              "clientId",
              "shippingService",
              "orderKey",
              "dateCreated",
              "shippingMethod",
              "notifiedPaidOrCompleted",
              "orderMeta",
              COALESCE("referralAwarded",FALSE)          AS "referralAwarded",
              COALESCE("pointsRedeemed",0) AS "pointsRedeemed"
         FROM orders
        WHERE id = $1
          FOR UPDATE`,
      [id],
    );

    if (!ord) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    /* 2️⃣ determine transition */
    const statusChanged = newStatus !== ord.status;
    const becameActive = isActive(newStatus) && !isActive(ord.status);
    const becameInactive = isInactive(newStatus) && !isInactive(ord.status);

    /* 3️⃣ fetch cart lines once (if needed) */
    let lines: any[] = [];
    if (becameActive || becameInactive) {
      const res = await client.query(
        `SELECT "productId","affiliateProductId",quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId" = $1`,
        [ord.cartId],
      );
      lines = res.rows;
    }

    /* 4️⃣ ACTIVE   → reserve stock & charge points */
    if (becameActive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          -1, // charge
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "purchase_affiliate",
          "Spent on affiliate purchase",
        );

      /* redeem-discount points (charge) */
      if (ord.pointsRedeemed > 0 && becameActive) {  // Only apply on transition to ACTIVE
        const pts = -ord.pointsRedeemed;  // e.g., -7
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
            (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
          VALUES($1,$2,$3,$4,'redeem_points','Redeemed points for discount',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, pts],
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
            ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
          VALUES($1,$2,$3,$4,NOW(),NOW())
          ON CONFLICT("clientId","organizationId") DO UPDATE
            SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + $3,
                "pointsSpent"   = "affiliatePointBalances"."pointsSpent"   + $4,
                "updatedAt"     = NOW()`,
          [ord.clientId, organizationId, pts, ord.pointsRedeemed],  // Use pts (-7) and ord.pointsRedeemed (7)
        );
      }
    }

    /* 5️⃣ INACTIVE → release stock & refund points */
    if (becameInactive) {
      for (const it of lines)
        await applyItemEffects(
          client,
          +1, // refund
          ord.country,
          organizationId,
          ord.clientId,
          it,
          "refund_affiliate",
          "Refund on cancelled order",
        );

      /* refund redeemed-discount points */
      if (ord.pointsRedeemed > 0) {
        const logId = uuidv4();
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES($1,$2,$3,$4,'refund_redeemed_points','Refund redeemed points on cancelled order',NOW(),NOW())`,
          [logId, organizationId, ord.clientId, ord.pointsRedeemed],
        );
        await client.query(
          `INSERT INTO "affiliatePointBalances"
             ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
           VALUES($1,$2,$3,$4,NOW(),NOW())
           ON CONFLICT("clientId","organizationId") DO UPDATE
             SET "pointsCurrent" = "affiliatePointBalances"."pointsCurrent" + EXCLUDED."pointsCurrent",
                 "pointsSpent"   = GREATEST(
                                     "affiliatePointBalances"."pointsSpent" + EXCLUDED."pointsSpent",
                                     0
                                   ),
                 "updatedAt"     = NOW()`,
          [ord.clientId, organizationId, ord.pointsRedeemed, -ord.pointsRedeemed],
        );
      }
    }

    /* 2a️⃣ no-op guard: if status didn’t change, skip all side-effects.
       This prevents duplicate Coinx PATCHes and email spam on retries. */
    if (!statusChanged) {
      await client.query("ROLLBACK");
      client.release();
      return NextResponse.json({ id, status: ord.status, warnings: ["No status change; skipped side-effects"] });
    }

    /* 6️⃣ finally update order status */
    const dateCol = DATE_COL_FOR_STATUS[newStatus];

    /* build the dynamic SET-clause */
    const sets: string[] = [
      `status = $1`,
      `"updatedAt" = NOW()`,
    ];
    if (dateCol) {
      sets.splice(1, 0, `"${dateCol}" = COALESCE("${dateCol}", NOW())`);
      // COALESCE keeps an existing timestamp if it was already set
    }

    console.log(`Updating order ${id} from ${ord.status} to ${newStatus}`);
    await client.query(
      `UPDATE orders
       SET ${sets.join(", ")}
     WHERE id = $2`,
      [newStatus, id],
    );
    console.log(`Order ${id} updated to ${newStatus}`);



    await client.query("COMMIT"); txOpen = false;
    console.log(`Transaction committed for order ${id}`);
    // release the transactional connection ASAP; do side-effects with pool
    client.release(); released = true;
    // 🔒 Ensure supplier orders exist before we cascade the status
    try { await ensureSupplierOrdersExist(id); } catch (e) { console.warn("[ensureSupplierOrders] failed:", e); }
    /* ──────────────────────────────────────────────────────────────
     * Cascade status to supplier “split” orders (baseKey and S-baseKey)
     * – normalize orderKey so 123 and S-123 are siblings
     * – update status + date cols on siblings
     * – after cascade to PAID, also generate revenue for siblings
     * ───────────────────────────────────────────────────────────── */
    const CASCADE_STATUSES = new Set(["paid", "cancelled", "refunded"]);
    if (CASCADE_STATUSES.has(newStatus)) {
      const dateCol = DATE_COL_FOR_STATUS[newStatus];
      const setBits = [`status = $1`, `"updatedAt" = NOW()`];
      if (dateCol) setBits.splice(1, 0, `"${dateCol}" = COALESCE("${dateCol}", NOW())`);
      const baseKey = String(ord.orderKey || "").replace(/^S-/, "");

      // capture sibling states BEFORE update (to decide stock effects)
      const { rows: beforeSibs } = await pool.query(
        `SELECT id, status, "cartId", country, "organizationId"
      FROM orders
     WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
       AND id <> $2`,
        [baseKey, id],
      );
      const sql = `
    UPDATE orders o
       SET ${setBits.join(", ")}
     WHERE (o."orderKey" = $2 OR o."orderKey" = ('S-' || $2))
       AND o.id <> $3
       AND o.status <> $1
  `;
      const { rowCount } = await pool.query(sql, [newStatus, baseKey, id]);
      console.log(`[cascade] ${newStatus} → ${rowCount} sibling orders for baseKey=${baseKey}`);

      // --- Notify supplier siblings that changed due to the cascade ---
  (async () => {
  // map status→notification type (repeat here or hoist globally)
  const notifTypeMap: Record<string, NotificationType> = {
    open: "order_placed",
    underpaid: "order_partially_paid",
    paid: "order_paid",
    completed: "order_completed",
    cancelled: "order_cancelled",
    refunded: "order_refunded",
  };

  // Only supplier siblings (S-xxxx) that now sit at the cascaded status
  const { rows: sibsForNotif } = await pool.query(
    `SELECT id, "organizationId", "clientId", "cartId", country, "orderKey",
            "shippingMethod","shippingService","trackingNumber","dateCreated",
            COALESCE("notifiedPaidOrCompleted", FALSE) AS "notified"
       FROM orders
      WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
        AND id <> $2
        AND status = $3
        AND "orderKey" LIKE 'S-%'`,
    [baseKey, id, newStatus],
  );

  for (const sb of sibsForNotif) {
    // Respect "only once" for paid/completed
    const should =
      newStatus === "paid" || newStatus === "completed"
        ? !sb.notified
        : newStatus === "cancelled" || newStatus === "refunded";

    if (!should) continue;

    const productList = await buildProductListForCart(sb.cartId);
    const orderDate = new Date(sb.dateCreated).toLocaleDateString("en-GB");

        try {
        await sendNotification({
      organizationId: sb.organizationId,              // supplier org
      type: notifTypeMap[newStatus],
      subject: `Order #${sb.orderKey} ${newStatus}`,
      message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
      variables: {
        product_list: productList,
        order_number: sb.orderKey,
        order_date: orderDate,
        order_shipping_method: sb.shippingMethod ?? "-",
        tracking_number: sb.trackingNumber ?? "",
        shipping_company: sb.shippingService ?? "",
      },
      country: sb.country,
      trigger: "admin_only",                          // admin-only fanout
      channels: ["in_app", "telegram"],               // same as elsewhere for suppliers
      clientId: null,
      url: `/orders/${sb.id}`,
           });
      } catch (e) {
        console.warn("[cascade][notify] failed for supplier sibling", sb.id, e);
        continue;
      }
    // Mark "notified" so we don’t notify twice for paid/completed
    if (newStatus === "paid" || newStatus === "completed") {
                try {
       await pool.query(
         `UPDATE orders
             SET "notifiedPaidOrCompleted" = TRUE,
                 "updatedAt" = NOW()
           WHERE id = $1`,
         [sb.id],
       );
     } catch (e) { console.warn("[cascade][notify] mark-notified failed", sb.id, e); }
    }
  }
      })();


      // Generate revenue for siblings when they become PAID as part of the cascade
      if (newStatus === "paid") {
        const { rows: sibs } = await pool.query(
          `SELECT id, "organizationId"
         FROM orders
        WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
          AND id <> $2
          AND status = 'paid'`,
          [baseKey, id],
        );
        for (const s of sibs) {
          try { await getRevenue(s.id, s.organizationId); }
          catch (e) { console.warn("[cascade] revenue sibling failed:", s.id, e); }
        }
      }

      // 🔧 STOCK EFFECTS for supplier siblings on cascade
      // apply when a sibling transitions across ACTIVE/INACTIVE boundary due to cascade
      for (const sb of beforeSibs) {
        const wasActive = isActive(sb.status);
        const willBeActive = isActive(newStatus);
        if (wasActive === willBeActive) continue; // no boundary change → skip
        const effectSign: 1 | -1 = willBeActive ? -1 : +1; // -1 reserve, +1 release
        const { rows: lines } = await pool.query(
          `SELECT "productId","affiliateProductId",quantity
        FROM "cartProducts" WHERE "cartId" = $1`,
          [sb.cartId],
        );
        for (const ln of lines) {
          if (ln.productId) {
            try { await adjustStock(pool as unknown as Pool, ln.productId, sb.country, effectSign * ln.quantity); }
            catch (e) { console.warn("[cascade][stock] product adjust failed", { orderId: sb.id, productId: ln.productId }, e); }
          }
          if (ln.affiliateProductId) {
            try { await adjustStock(pool as unknown as Pool, ln.affiliateProductId, sb.country, effectSign * ln.quantity); }
            catch (e) { console.warn("[cascade][stock] affiliate adjust failed", { orderId: sb.id, productId: ln.affiliateProductId }, e); }
          }
        }
      }

      // On cancel/refund, cancel sibling revenues too
      if (newStatus === "cancelled" || newStatus === "refunded") {
        await pool.query(
          `UPDATE "orderRevenue"
          SET cancelled = TRUE, "updatedAt" = NOW()
        WHERE "orderId" IN (
          SELECT id FROM orders
           WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
        )`,
          [baseKey],
        );
      }
    }

    /* ──────────────────────────────────────────────────────────────
   *  Niftipay (Coinx) sync via merchant API key
   *  – use the merchant's own key saved in paymentMethods
   *  – mirrors Trapigram status → Coinx order status
   *    supported here: cancelled, paid
   * ───────────────────────────────────────────────────────────── */
    if (
      ord.paymentMethod?.toLowerCase?.() === "niftipay" &&
      (newStatus === "cancelled" || newStatus === "paid")
    ) {
      try {
        // 1) load the merchant's Niftipay key by tenantId (paymentMethods is tenant-scoped)
        let merchantApiKey: string | null = null;
        if (tenantId) {
          const { rows: [pm] } = await pool.query(
            `SELECT "apiKey"
              FROM "paymentMethods"
              WHERE "tenantId" = $1
                AND lower(name) = 'niftipay'
                AND "active" = TRUE
              LIMIT 1`,
            [tenantId],
          );
          merchantApiKey = pm?.apiKey ?? null;
        }
        if (!merchantApiKey) {
          console.warn("[niftipay] No merchant API key configured for tenant", tenantId);
          toastWarnings.push(
            "Niftipay not configured for this organisation (missing API key). Crypto invoice was not updated."
          );
        } else {


          const base = process.env.NIFTIPAY_API_URL || "https://www.niftipay.com";
          const targetStatus = newStatus === "cancelled" ? "cancelled" : "paid";
          console.log(`[coinx] sync → ${targetStatus}; orderKey=${ord.orderKey}; base=${base}`);

          // 2) Try to PATCH by Coinx orderId obtained from our orderMeta (webhook payload)
          //    This is the most reliable path and avoids reference-mismatch issues.
          let patched = false;
          try {
            const metaArr =
              Array.isArray(ord.orderMeta) ? ord.orderMeta : JSON.parse(ord.orderMeta ?? "[]");
            const fromNewest = [...metaArr].reverse();
            // prefer an explicit "pending" event, else fall back to any event that carries an order.id
            const evtWithId =
              fromNewest.find((m: any) => (m?.event ?? "").toLowerCase() === "pending" && m?.order?.id) ??
              fromNewest.find((m: any) => m?.order?.id);
            const coinxOrderId: string | undefined = evtWithId?.order?.id;

            if (coinxOrderId) {
              console.log(`[coinx] attempting direct PATCH by id=${coinxOrderId}`);
              // add a short timeout to avoid hitting the 15s function limit
              const ac = new AbortController();
              const to = setTimeout(() => ac.abort(), 4000);
              const patchRes = await fetch(`${base}/api/orders/${coinxOrderId}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "Accept": "application/json",
                  "x-api-key": merchantApiKey,
                },
                body: JSON.stringify({ status: targetStatus }),
                signal: ac.signal,
              });
              clearTimeout(to);
              const body = await patchRes.json().catch(async () => {
                const txt = await patchRes.text().catch(() => "");
                return { _raw: txt };
              });
              if (!patchRes.ok) {
                console.error("[coinx] PATCH by id failed:", body);
                // fall through to reference-based lookup
              } else {
                patched = true;
                console.log(`[coinx] ok – status set to ${targetStatus} (by id)`);
                if (Array.isArray((body as any)?.warnings)) {
                  for (const w of (body as any).warnings) {
                    toastWarnings.push(typeof w === "string" ? w : w?.message || "Coinx reported a warning.");
                  }
                }
              }
            } else {
              console.log("[coinx] no order.id in orderMeta; will try reference lookup");
            }
          } catch (e) {
               const msg = String((e as any)?.message || e);
            if (msg.includes("The operation was aborted") || msg.includes("AbortError")) {
              console.warn("[coinx] PATCH by id timed out; falling back to reference lookup.");
            } else {
              console.warn("[coinx] meta parse / id-path failed; will try reference lookup:", e);
            }
          }
          

          // 3) Fallback: find Coinx order by our orderKey stored as 'reference' on Coinx
          if (!patched) {
            const findUrl = `${base}/api/orders?reference=${encodeURIComponent(String(ord.orderKey ?? ""))}`;
            const ac2 = new AbortController();
            const to2 = setTimeout(() => ac2.abort(), 6000);
            const findRes = await fetch(findUrl, {
              headers: { "Accept": "application/json", "x-api-key": merchantApiKey },
              signal: ac2.signal,
            });
            clearTimeout(to2);
            if (!findRes.ok) {
              const t = await findRes.text().catch(() => "");
              console.error("[niftipay] GET /api/orders failed:", t);
              toastWarnings.push("Could not look up Coinx invoice for this order (network/API error).");
            } else {
              const data = await findRes.json().catch(() => ({}));
              const coinxOrder = (data?.orders || []).find(
                (o: any) => String(o.reference) === String(ord.orderKey)
              );
              if (!coinxOrder) {
                toastWarnings.push(
                  `No Coinx invoice matched reference "${ord.orderKey}". Ensure Coinx reference equals Trapigram orderKey.`
                );
              } else {
                const patchRes = await fetch(`${base}/api/orders/${coinxOrder.id}`, {
                  method: "PATCH",
                  headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "x-api-key": merchantApiKey,
                  },
                  body: JSON.stringify({ status: targetStatus }),
                });
                const body = await patchRes.json().catch(async () => {
                  const txt = await patchRes.text().catch(() => "");
                  return { _raw: txt };
                });
                if (!patchRes.ok) {
                  console.error("[niftipay] PATCH /api/orders/:id failed:", body);
                  toastWarnings.push("Coinx refused the status update. The invoice may not exist or the API key is invalid.");
                } else if (Array.isArray((body as any)?.warnings) && (body as any).warnings.length) {
                  for (const w of (body as any).warnings) {
                    toastWarnings.push(typeof w === "string" ? w : w?.message || "Coinx reported a warning.");
                  }
                } else {
                  console.log(`[coinx] ok – status set to ${targetStatus} (by reference fallback)`);
                }
              }
            }
          }
        }
      } catch (err) {
        console.error("[niftipay] sync error:", err);
        toastWarnings.push("Unexpected error while syncing with Coinx.");

      }
    }

    // ─── trigger revenue/fee **only** on the first transition to PAID ───
    if (newStatus === "paid" && ord.status !== "paid") {
      try {
        // 1) update revenue
        await getRevenue(id, organizationId);
        console.log(`Revenue updated for order ${id}`);

        // 2) capture platform fee via internal API
        const feesUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/order-fees`;
        console.log(`[fees] POST → ${feesUrl}`, {
          orderId: id,
          orgId: organizationId,
          hasSecret: Boolean(process.env.INTERNAL_API_SECRET),
        });
        const feeRes = await fetch(feesUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-internal-secret": process.env.INTERNAL_API_SECRET!, // ✅ match requireInternalAuth
          },
          body: JSON.stringify({ orderId: id }),
        });
        const feeText = await feeRes.text().catch(() => "");
        if (!feeRes.ok) {
          console.error(
            `[fees] ← ${feeRes.status} ${feeRes.statusText}; body=${feeText || "<empty>"}`
          );
          toastWarnings.push("Couldn’t record platform fee (internal API).");
        } else {
          let parsed: any = null;
          try { parsed = JSON.parse(feeText); } catch { }
          console.log(`[fees] ok – inserted`, parsed?.item ?? feeText);
          console.log(`Platform fee captured for order ${id}`);
        }

      } catch (err) {
        console.error(
          `Failed to update revenue or capture fee for order ${id}:`,
          err
        );
      }
    }
    console.log(newStatus)
    if (newStatus === "cancelled") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = TRUE, refunded = FALSE, "updatedAt" = NOW() WHERE "orderId" = '${id}' RETURNING *`
        const statusResult = await pool.query(statusQuery)
        const result = statusResult.rows
        console.log(result)
      } catch (err) {
        console.error(
          `Failed to update revenue for order ${id}:`,
          err
        );
      }
    }

    if (newStatus === "refunded") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = FALSE, refunded = TRUE, "updatedAt" = NOW() WHERE "orderId" = '${id}' RETURNING *`
        const statusResult = await pool.query(statusQuery)
        const result = statusResult.rows
        console.log(result)
      } catch (err) {
        console.error(
          `Failed to update revenue for order ${id}:`,
          err
        );
      }
    }

    if (newStatus !== "refunded" && newStatus !== "cancelled") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = FALSE, refunded = FALSE, "updatedAt" = NOW() WHERE "orderId" = '${id}' RETURNING *`
        const statusResult = await pool.query(statusQuery)
        const result = statusResult.rows[0]
        console.log(result)
      } catch (err) {
        console.error(
          `Failed to update revenue for order ${id}:`,
          err
        );
      }
    }



    /* ─────────────────────────────────────────────
     *  Notification logic
     * ───────────────────────────────────────────── */
    let shouldNotify = false;

    /* —— NEW order placed check —— */               // NEW ⬅︎
    if (newStatus === "open" && ord.status !== "open") { // NEW ⬅︎
      shouldNotify = true;                              // NEW ⬅︎
    }                                                   // NEW ⬅︎
    else if (newStatus === "underpaid") {
      shouldNotify = true;                     // notify always on first underpaid
    } else if (FIRST_NOTIFY_STATUSES.includes(
      newStatus as (typeof FIRST_NOTIFY_STATUSES)[number])) {
      // fire only once across PAID/COMPLETED
      shouldNotify = !ord.notifiedPaidOrCompleted;
    } else if (newStatus === "cancelled" || newStatus === "refunded") {
      shouldNotify = true;
    }

    if (shouldNotify) {
      // product list for THIS order/cart only
      const productList = await buildProductListForCart(ord.cartId);

      /* map status → notification type */
      /* ── gather extra variables for the “underpaid” e-mail ───────────── */
      let receivedAmt = "";
      let expectedAmt = "";
      let assetSymbol = "";
      if (newStatus === "underpaid") {
        try {
          /* orderMeta can arrive as JSON **object** (pg-json) or string — normalise */
          const metaArr =
            Array.isArray(ord.orderMeta)
              ? ord.orderMeta
              : JSON.parse(ord.orderMeta ?? "[]");

          const latest = [...metaArr]
            .reverse()
            .find((m: any) => (m.event ?? "").toLowerCase() === "underpaid");

          receivedAmt = latest?.order?.received ?? "";
          expectedAmt = latest?.order?.expected ?? "";
          assetSymbol = latest?.order?.asset ?? "";
        } catch {
          /* leave placeholders empty on malformed data */
        }
      }

      const pendingAmt =
        receivedAmt && expectedAmt
          ? String(Number(expectedAmt) - Number(receivedAmt))
          : "";

      const notifTypeMap: Record<string, NotificationType> = {
        open: "order_placed",
        underpaid: "order_partially_paid",   // NEW ⬅︎
        paid: "order_paid",
        completed: "order_completed",
        cancelled: "order_cancelled",
        refunded: "order_refunded",
      } as const;
      const notifType: NotificationType =
        notifTypeMap[newStatus] || "order_ready";

      const orderDate = new Date(ord.dateCreated).toLocaleDateString("en-GB");

      const isSupplierOrder = String(ord.orderKey || "").startsWith("S-");
            // statuses that should alert store admins for buyer orders
      const ADMIN_ALERT_STATUSES = new Set(["underpaid", "paid", "completed", "cancelled", "refunded"]);
      // keep “only-once” semantics for paid/completed
      const adminEligibleOnce =
        (newStatus === "paid" || newStatus === "completed") ? !ord.notifiedPaidOrCompleted : true;
 
      const baseNotificationPayload = {
        organizationId,
        type: notifType,
        subject: `Order #${ord.orderKey} ${newStatus}`,
        message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
        country: ord.country,
        variables: {
          product_list: productList,
          order_number: ord.orderKey,
          order_date: orderDate,
          order_shipping_method: ord.shippingMethod ?? "-",
          tracking_number: ord.trackingNumber ?? "",
          expected_amt: expectedAmt,
          received_amt: receivedAmt,
          shipping_company: ord.shippingService ?? "",
          pending_amt: pendingAmt,
          asset: assetSymbol,
        },
      } as const;

      if (isSupplierOrder) {
        // Supplier (shared) order:
        //  • Always notify supplier admins (in_app + telegram)
        //  • Buyer gets ONLY an email and ONLY when status === "completed"
        await sendNotification({
          ...baseNotificationPayload,
          trigger: "admin_only",
          channels: ["in_app", "telegram"],
          clientId: null,
          url: `/orders/${id}`,
        });
        if (newStatus === "completed") {
          await sendNotification({
            ...baseNotificationPayload,
            trigger: "user_only_email",
            channels: ["email"],
            clientId: ord.clientId,
            url: `/orders/${id}`,
          });
        }
      } else {
       // Normal (buyer) order – notify the buyer as before…
        await sendNotification({
          ...baseNotificationPayload,
          trigger: "order_status_change",
          channels: ["email", "in_app", "telegram"],
          clientId: ord.clientId,
          url: `/orders/${id}`,
        });
            // …and ALSO notify store admins for key statuses
          if (ADMIN_ALERT_STATUSES.has(newStatus) && adminEligibleOnce) {
            await sendNotification({
              ...baseNotificationPayload,
              trigger: "admin_only",
              channels: ["in_app", "telegram"],
              clientId: null,
              url: `/orders/${id}`,
            });
            }
      } 

      /* ─────────────────────────────────────────────────────────────
      *  Affiliate / referral bonuses
      *     – ONLY once, when the order first becomes PAID
      * ──────────────────────────────────────────────────────────── */
      if (newStatus === "paid" && ord.status !== "paid") {
        /*  1) fetch affiliate-settings (points & steps) */
        /* ── grab settings (use real column names, alias them to old variable names) ── */
        const { rows: [affSet] } = await pool.query(
          `SELECT "pointsPerReferral",
              "spendingNeeded"      AS "spendingStep",
              "pointsPerSpending"   AS "pointsPerSpendingStep"
       FROM "affiliateSettings"
      WHERE "organizationId" = $1
      LIMIT 1`,
          [organizationId],
        );

        const ptsPerReferral = Number(affSet?.pointsPerReferral || 0);
        const stepEur = Number(affSet?.spendingStep || 0);   // ← alias above
        const ptsPerStep = Number(affSet?.pointsPerSpendingStep || 0);   // ← alias above */

        /*  2) has this buyer been referred?  award referrer once   */
        const { rows: [cli] } = await pool.query(

          `SELECT "referredBy" FROM clients WHERE id = $1`,
          [ord.clientId],
        );

        if (!ord.referralAwarded && cli?.referredBy && ptsPerReferral > 0) {
          const logId = uuidv4();
          await pool.query(
            `INSERT INTO "affiliatePointLogs"
         (id,"organizationId","clientId",points,action,description,
          "sourceClientId","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,'referral_bonus',
               'Bonus from referral order',$5,NOW(),NOW())`,
            [logId, organizationId, cli.referredBy, ptsPerReferral, ord.clientId],
          );
          await pool.query(
            `INSERT INTO "affiliatePointBalances" AS b
         ("clientId","organizationId","pointsCurrent","createdAt","updatedAt")
       VALUES ($1,$2,$3,NOW(),NOW())
       ON CONFLICT("clientId","organizationId") DO UPDATE
         SET "pointsCurrent" = b."pointsCurrent" + EXCLUDED."pointsCurrent",
             "updatedAt"     = NOW()`,
            [cli.referredBy, organizationId, ptsPerReferral],
          );
          /* mark order so we never double-award this ref bonus */
          await pool.query(
            `UPDATE orders
          SET "referralAwarded" = TRUE,
              "updatedAt"       = NOW()
        WHERE id = $1`,
            [id],
          );
        }
        /*  3) spending milestones for *buyer*  (step-based)        */
        if (stepEur > 0 && ptsPerStep > 0) {
          /* --------------------------------------------------------------
           * Lifetime spend in **EUR** – we rely on orderRevenue which was
           * (re)-generated a few lines above for this order.
           * -------------------------------------------------------------- */
          const { rows: [spent] } = await pool.query(
            `SELECT COALESCE(SUM(r."EURtotal"),0) AS sum
         FROM "orderRevenue" r
         JOIN orders o ON o.id = r."orderId"
        WHERE o."clientId"       = $1
          AND o."organizationId" = $2
          AND o.status           = 'paid'`,
            [ord.clientId, organizationId],
          );

          const totalEur = Number(spent.sum);   // already a decimal string → number
          /* how many spending-bonuses already written? */
          const { rows: [prev] } = await pool.query(
            `SELECT COALESCE(SUM(points),0) AS pts
         FROM "affiliatePointLogs"
        WHERE "organizationId" = $1
          AND "clientId"       = $2
         AND action           = 'spending_bonus'`,
            [organizationId, ord.clientId],
          );

          const shouldHave = Math.floor(totalEur / stepEur) * ptsPerStep;
          const delta = shouldHave - Number(prev.pts);

          console.log(
            `[affiliate] spending check – client %s: total %s EUR, step %d, ` +
            `prev %d pts, delta %d`,
            ord.clientId,
            totalEur.toFixed(2),
            stepEur,
            Number(prev.pts),
            delta,
          );

          if (delta > 0) {
            const logId = uuidv4();
            await pool.query(
              `INSERT INTO "affiliatePointLogs"
           (id,"organizationId","clientId",points,action,description,
            "createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,'spending_bonus',
                 'Milestone spending bonus',NOW(),NOW())`,
              [logId, organizationId, ord.clientId, delta],
            );
            await pool.query(
              `INSERT INTO "affiliatePointBalances" AS b
           ("clientId","organizationId","pointsCurrent","createdAt","updatedAt")
         VALUES ($1,$2,$3,NOW(),NOW())
         ON CONFLICT("clientId","organizationId") DO UPDATE
           SET "pointsCurrent" = b."pointsCurrent" + EXCLUDED."pointsCurrent",
               "updatedAt"     = NOW()`,
              [ord.clientId, organizationId, delta],
            );
          }
        }
      }

      /* mark as notified on first PAID **or** COMPLETED to prevent repeats */
      if ((newStatus === "paid" || newStatus === "completed") && !ord.notifiedPaidOrCompleted) {
        await pool.query(
          `UPDATE orders
          SET "notifiedPaidOrCompleted" = TRUE,
              "updatedAt" = NOW()
        WHERE id = $1`,
          [id],
        );
      }
    }

    return NextResponse.json({ id, status: newStatus, warnings: toastWarnings });
  } catch (e) {
    if (txOpen) await client.query("ROLLBACK");
    console.error("[PATCH /api/order/:id/change-status]", e);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    if (!released) client.release();
  }
}
