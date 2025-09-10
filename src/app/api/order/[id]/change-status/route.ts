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
import { enqueueNotificationFanout } from "@/lib/notification-outbox";
import { processAutomationRules } from "@/lib/rules";

// Vercel runtime hints (keep these AFTER all imports)
export const runtime = "nodejs";
export const preferredRegion = ["iad1"];

// Small helper: fetch with timeout and JSON parsing
async function fetchJSON(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<{ res: Response; data: any }> {
  const { timeoutMs = 5000, ...rest } = init ?? {};
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...rest, signal: ac.signal });
    let data: any = null;
    try { data = await res.json(); } catch { /* non-json */ }
    return { res, data };
  } finally {
    clearTimeout(to);
  }
}


// ── diagnostics ──────────────────────────────────────────────

const apiKey = process.env.CURRENCY_LAYER_API_KEY
const dbg = (...a: any[]) => console.log("[orderRevenue]", ...a);
if (!apiKey) console.warn("[orderRevenue] ⚠️  CURRENCY_LAYER_API_KEY is not set");
/* === Patch getRevenue: guard Coinx crypto calc to require a PAID meta === */
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

// Map country → 3-letter currency (fallback USD)
const currencyFromCountry = (c: string) =>
  c === "GB" ? "GBP" : euroCountries.includes(c) ? "EUR" : "USD";

const coins: Record<string, string> = {
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'USDT': 'tether',
  'USDT.ERC20': 'tether',
  'USDT.TRC20': 'tether',
  // add to the existing map
  'USDC': 'usd-coin',
  'USDC.ERC20': 'usd-coin',
  'USDC.TRC20': 'usd-coin',
  'USDC.SOL': 'usd-coin',
  'USDC.SPL': 'usd-coin',
  'USDC.POLYGON': 'usd-coin',
  'USDC.BEP20': 'usd-coin',
  'USDC.ARBITRUM': 'usd-coin',
  'USDC.OPTIMISM': 'usd-coin',
  'USDC.BASE': 'usd-coin',

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

// Parameterized insert to avoid SQL injection / NaN strings.
async function insertOrderRevenue(
  revenueId: string,
  orderId: string,
  organizationId: string,
  v: {
    USDtotal: number; USDdiscount: number; USDshipping: number; USDcost: number;
    GBPtotal: number; GBPdiscount: number; GBPshipping: number; GBPcost: number;
    EURtotal: number; EURdiscount: number; EURshipping: number; EURcost: number;
  }
) {
  const sql = `
    INSERT INTO "orderRevenue" (
      id,"orderId",
      "USDtotal","USDdiscount","USDshipping","USDcost",
      "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
      "EURtotal","EURdiscount","EURshipping","EURcost",
      "createdAt","updatedAt","organizationId"
    ) VALUES (
      $1,$2,
      $3,$4,$5,$6,
      $7,$8,$9,$10,
      $11,$12,$13,$14,
      NOW(),NOW(),$15
       )
    RETURNING *`;

  const params = [
    revenueId, orderId,
    v.USDtotal, v.USDdiscount, v.USDshipping, v.USDcost,
    v.GBPtotal, v.GBPdiscount, v.GBPshipping, v.GBPcost,
    v.EURtotal, v.EURdiscount, v.EURshipping, v.EURcost,
    organizationId,
  ];
  const { rows } = await pool.query(sql, params);
  console.log(rows[0])
  return rows[0];
}

async function insertCategoryRevenue(catRevenueId: string, categoryId: string, organizationId: string, v: {
  USDtotal: number; USDcost: number; GBPtotal: number; GBPcost: number; EURtotal: number; EURcost: number;
}) {
  const sql = `INSERT INTO "categoryRevenue" (id,"categoryId","USDtotal","USDcost","GBPtotal","GBPcost","EURtotal","EURcost","createdAt","updatedAt","organizationId")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),$9)`;
  await pool.query(sql, [catRevenueId, categoryId, v.USDtotal, v.USDcost, v.GBPtotal, v.GBPcost, v.EURtotal, v.EURcost, organizationId]);
}

async function getRevenue(id: string, organizationId: string) {
  try {
    // 0) short-circuit if revenue already exists
    const { rows: existing } = await pool.query(
      `SELECT * FROM "orderRevenue" WHERE "orderId" = $1 LIMIT 1`,
      [id]
    );
    if (existing.length) {
      console.log("[orderRevenue] revenue-already-exists", {
        orderId: id,
        rows: existing.length,
      });
      return existing[0];
    }

    // 1) load order
    const { rows: orderRows } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, organizationId]
    );
    const order: any = orderRows[0];
    if (!order) throw new Error("Order not found");

    const cartId: string = order.cartId;
    const paymentType = String(order.paymentMethod ?? "").toLowerCase();
    const country: string = order.country;

    // 2) helpers: effective shared cost resolver with tiny caches
    const mappingCache = new Map<
      string,
      { shareLinkId: string; sourceProductId: string } | null
    >();
    const costCache = new Map<string, number>();

    async function resolveEffectiveCost(productId: string): Promise<number> {
      const cacheKey = `${productId}:${country}`;
      if (costCache.has(cacheKey)) return costCache.get(cacheKey)!;

      // find upstream mapping (if this is a shared clone)
      let mapping = mappingCache.get(productId);
      if (mapping === undefined) {
        const { rows: [m] } = await pool.query(
          `SELECT "shareLinkId","sourceProductId"
             FROM "sharedProductMapping"
            WHERE "targetProductId" = $1
            LIMIT 1`,
          [productId],
        );
        mapping = m ? { shareLinkId: m.shareLinkId, sourceProductId: m.sourceProductId } : null;
        mappingCache.set(productId, mapping);
      }

      let eff = 0;
      if (mapping) {
        const { rows: [sp] } = await pool.query(
          `SELECT cost
             FROM "sharedProduct"
            WHERE "shareLinkId" = $1 AND "productId" = $2
            LIMIT 1`,
          [mapping.shareLinkId, mapping.sourceProductId],
        );
        eff = Number(sp?.cost?.[country] ?? 0);
      } else {
        const { rows: [p] } = await pool.query(
          `SELECT cost FROM products WHERE id = $1 LIMIT 1`,
          [productId],
        );
        eff = Number(p?.cost?.[country] ?? 0);
      }

      costCache.set(cacheKey, eff);
      return eff;
    }

    // 3) settle the "paid" timestamp window for FX/crypto
    const rawPaid = order.datePaid ?? order.dateCreated;
    const paidDate: Date = rawPaid instanceof Date ? rawPaid : new Date(rawPaid);
    if (Number.isNaN(paidDate.getTime())) throw new Error("Invalid paid date");

    const to = Math.floor(paidDate.getTime() / 1000);
    const from = to - 3600; // look back 1 hour for CoinGecko range

    // 4) cart lines (normal  affiliate)  categories
    const { rows: prodRows } = await pool.query(
      `SELECT p.*, cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN products p ON cp."productId" = p.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const { rows: affRows } = await pool.query(
      `SELECT ap.*, cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN "affiliateProducts" ap ON cp."affiliateProductId" = ap.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );

    // category breakdown for native products (affiliate lines are not categorised here)
    const { rows: catRows } = await pool.query(
      `SELECT cp.quantity, cp."unitPrice", p."id" AS "productId", pc."categoryId"
         FROM "cartProducts" AS cp
         JOIN "products"  AS p  ON cp."productId" = p."id"
    LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
        WHERE cp."cartId" = $1`,
      [cartId],
    );

    const categories: CategoryRevenue[] = [];
    for (const ct of catRows) {
      const qty = Number(ct.quantity ?? 0);
      const unitPrice = Number(ct.unitPrice ?? 0);
      const effCost = await resolveEffectiveCost(String(ct.productId));
      categories.push({
        categoryId: ct.categoryId,
        price: unitPrice,
        cost: effCost,
        quantity: qty,
      });
    }

    const newCategories: TransformedCategoryRevenue[] = categories.map(
      ({ categoryId, price, cost, quantity }) => ({
        categoryId,
        total: price * quantity,
        cost: cost * quantity,
      }),
    );

    // 5) total COST: native products use effective shared cost; affiliate keep their own
    const productsCost = categories.reduce((sum, c) => sum + c.cost * c.quantity, 0);
    const affiliateCost = affRows.reduce((sum, a: any) => {
      const unitCost = Number(a?.cost?.[country] ?? 0);
      const qty = Number(a?.quantity ?? 0);
      return sum + unitCost * qty;
    }, 0);
    const totalCost = productsCost + affiliateCost;

    // 6) crypto override (only if Niftipay AND we have a PAID entry with asset amount)
    let totalUsdFromCrypto = 0;
    let applyCryptoOverride = false;
    let coinRaw = "";
    let amount = 0;

    if (paymentType === "niftipay") {
      const metaArr: any[] = Array.isArray(order.orderMeta)
        ? order.orderMeta
        : JSON.parse(order.orderMeta ?? "[]");

      const paidEntry = metaArr.find(
        (m) => String(m?.event ?? "").toLowerCase() === "paid",
      );

      if (paidEntry) {
        coinRaw = String(paidEntry?.order?.asset ?? "");
        amount = Number(paidEntry?.order?.amount ?? 0);
        applyCryptoOverride = Boolean(coinRaw && amount > 0);
      }
    }

    if (applyCryptoOverride) {
      const coinKey = coinRaw.toUpperCase();
      const coinId = coins[coinKey];
      if (!coinId) {
        dbg("⚠️ unsupported asset:", coinKey);
        throw new Error(`Unsupported crypto asset "${coinKey}"`);
      }
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
      dbg("CoinGecko →", url);
      const { res: cgRes, data: cgData } = await fetchJSON(url, {
        method: "GET",
        headers: { accept: "application/json" },
        timeoutMs: 5000,
      });
      dbg("CoinGecko ←", cgRes.status, cgRes.statusText);
      if (!cgRes.ok) throw new Error(`HTTP ${cgRes.status} – ${cgRes.statusText}`);

      const prices = Array.isArray(cgData?.prices) ? cgData.prices : [];
      const last = prices.length ? prices[prices.length - 1] : null;
      const price = Array.isArray(last) ? Number(last[1]) : null;
      if (price == null || Number.isNaN(price)) throw new Error("No price data from CoinGecko");

      totalUsdFromCrypto = amount * price; // USD
    }

    // 7) FX – get nearest cached rate at/just before paidDate; if missing, pull  insert
    const { rows: fxRows } = await pool.query(
      `SELECT "EUR","GBP"
         FROM "exchangeRate"
        WHERE date <= to_timestamp($1)
     ORDER BY date DESC
        LIMIT 1`,
      [to],
    );

    let USDEUR = 0;
    let USDGBP = 0;

    if (!fxRows.length) {
      const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
      dbg("CurrencyLayer →", url);
      const { res: clRes, data } = await fetchJSON(url, { timeoutMs: 5000 });
      dbg("CurrencyLayer ←", clRes.status, clRes.statusText);

      const usdEur = Number(data?.quotes?.USDEUR ?? 0);
      const usdGbp = Number(data?.quotes?.USDGBP ?? 0);
      if (!(usdEur > 0) || !(usdGbp > 0)) return { error: "Invalid FX API response" };

      const { rows: ins } = await pool.query(
        `INSERT INTO "exchangeRate" ("EUR","GBP", date)
         VALUES ($1,$2,$3)
         RETURNING *`,
        [usdEur, usdGbp, new Date(paidDate)],
      );

      USDEUR = Number(ins[0].EUR);
      USDGBP = Number(ins[0].GBP);
    } else {
      USDEUR = Number(fxRows[0].EUR);
      USDGBP = Number(fxRows[0].GBP);
    }

    // 8) compute totals by native currency, then convert; only override the totals if crypto was used
    const revenueId = uuidv4();

    if (country === "GB") {
      // native GBP
      const discountGBP = Number(order.discountTotal ?? 0);
      const shippingGBP = Number(order.shippingTotal ?? 0);
      const costGBP = totalCost;
      let totalGBP = Number(order.totalAmount ?? 0);

      const discountUSD = discountGBP / USDGBP;
      const shippingUSD = shippingGBP / USDGBP;
      const costUSD = costGBP / USDGBP;
      let totalUSD = totalGBP / USDGBP;

      const discountEUR = discountGBP * (USDEUR / USDGBP);
      const shippingEUR = shippingGBP * (USDEUR / USDGBP);
      const costEUR = costGBP * (USDEUR / USDGBP);
      let totalEUR = totalGBP * (USDEUR / USDGBP);

      // crypto override: replace totals only
      if (applyCryptoOverride) {
        totalUSD = totalUsdFromCrypto;
        totalEUR = totalUsdFromCrypto * USDEUR;
        totalGBP = totalUsdFromCrypto * USDGBP;
      }

      const revenue = await insertOrderRevenue(revenueId, id, organizationId, {
        USDtotal: totalUSD,
        USDdiscount: discountUSD,
        USDshipping: shippingUSD,
        USDcost: costUSD,
        GBPtotal: totalGBP,
        GBPdiscount: discountGBP,
        GBPshipping: shippingGBP,
        GBPcost: costGBP,
        EURtotal: totalEUR,
        EURdiscount: discountEUR,
        EURshipping: shippingEUR,
        EURcost: costEUR,
      });

      // category breakdown: native GBP → USD=GBP/USDGBP, EUR=GBP*(USDEUR/USDGBP)
      for (const ct of newCategories) {
        const catRevenueId = uuidv4();
        await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
          USDtotal: ct.total / USDGBP,
          USDcost: ct.cost / USDGBP,
          GBPtotal: ct.total,
          GBPcost: ct.cost,
          EURtotal: ct.total * (USDEUR / USDGBP),
          EURcost: ct.cost * (USDEUR / USDGBP),
        });
      }

      return revenue;
    } else if (euroCountries.includes(country)) {
      // native EUR
      const discountEUR = Number(order.discountTotal ?? 0);
      const shippingEUR = Number(order.shippingTotal ?? 0);
      const costEUR = totalCost;
      let totalEUR = Number(order.totalAmount ?? 0);

      const discountUSD = discountEUR / USDEUR;
      const shippingUSD = shippingEUR / USDEUR;
      const costUSD = costEUR / USDEUR;
      let totalUSD = totalEUR / USDEUR;

      const discountGBP = discountEUR * (USDGBP / USDEUR);
      const shippingGBP = shippingEUR * (USDGBP / USDEUR);
      const costGBP = costEUR * (USDGBP / USDEUR);
      let totalGBP = totalEUR * (USDGBP / USDEUR);

      if (applyCryptoOverride) {
        totalUSD = totalUsdFromCrypto;
        totalEUR = totalUsdFromCrypto * USDEUR;
        totalGBP = totalUsdFromCrypto * USDGBP;
      }

      const revenue = await insertOrderRevenue(revenueId, id, organizationId, {
        USDtotal: totalUSD,
        USDdiscount: discountUSD,
        USDshipping: shippingUSD,
        USDcost: costUSD,
        GBPtotal: totalGBP,
        GBPdiscount: discountGBP,
        GBPshipping: shippingGBP,
        GBPcost: costGBP,
        EURtotal: totalEUR,
        EURdiscount: discountEUR,
        EURshipping: shippingEUR,
        EURcost: costEUR,
      });

      // category breakdown: native EUR → USD=EUR/USDEUR, GBP=EUR*(USDGBP/USDEUR)
      for (const ct of newCategories) {
        const catRevenueId = uuidv4();
        await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
          USDtotal: ct.total / USDEUR,
          USDcost: ct.cost / USDEUR,
          GBPtotal: ct.total * (USDGBP / USDEUR),
          GBPcost: ct.cost * (USDGBP / USDEUR),
          EURtotal: ct.total,
          EURcost: ct.cost,
        });
      }

      return revenue;
    } else {
      // native USD (default)
      const discountUSD = Number(order.discountTotal ?? 0);
      const shippingUSD = Number(order.shippingTotal ?? 0);
      const costUSD = totalCost;
      let totalUSD = Number(order.totalAmount ?? 0);

      const discountEUR = discountUSD * USDEUR;
      const shippingEUR = shippingUSD * USDEUR;
      const costEUR = costUSD * USDEUR;
      let totalEUR = totalUSD * USDEUR;

      const discountGBP = discountUSD * USDGBP;
      const shippingGBP = shippingUSD * USDGBP;
      const costGBP = costUSD * USDGBP;
      let totalGBP = totalUSD * USDGBP;

      if (applyCryptoOverride) {
        totalUSD = totalUsdFromCrypto;
        totalEUR = totalUsdFromCrypto * USDEUR;
        totalGBP = totalUsdFromCrypto * USDGBP;
      }

      const revenue = await insertOrderRevenue(revenueId, id, organizationId, {
        USDtotal: totalUSD,
        USDdiscount: discountUSD,
        USDshipping: shippingUSD,
        USDcost: costUSD,
        GBPtotal: totalGBP,
        GBPdiscount: discountGBP,
        GBPshipping: shippingGBP,
        GBPcost: costGBP,
        EURtotal: totalEUR,
        EURdiscount: discountEUR,
        EURshipping: shippingEUR,
        EURcost: costEUR,
      });

      // category breakdown: native USD → EUR=USD*USDEUR, GBP=USD*USDGBP
      for (const ct of newCategories) {
        const catRevenueId = uuidv4();
        await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
          USDtotal: ct.total,
          USDcost: ct.cost,
          GBPtotal: ct.total * USDGBP,
          GBPcost: ct.cost * USDGBP,
          EURtotal: ct.total * USDEUR,
          EURcost: ct.cost * USDEUR,
        });
      }

      return revenue;
    }
  } catch (error) {
    console.error("[getRevenue] error:", error);
    return error;
  }
}


/* ───────── helpers ───────── */
/** Stock & points stay RESERVED while the order is *underpaid*. */
const ACTIVE = ["open", "underpaid", "pending_payment", "paid", "completed"]; // stock & points RESERVED
const INACTIVE = ["cancelled", "failed", "refunded"];      // stock & points RELEASED
const ALLOWED_STATUSES = [
  "open",
  "underpaid",
  "pending_payment",
  "paid",
  "completed",
  "cancelled",
  "refunded",
  "failed",
] as const;
const orderStatusSchema = z.object({ status: z.enum(ALLOWED_STATUSES) });
/* record-the-date helper */
const DATE_COL_FOR_STATUS: Record<string, string | undefined> = {
  underpaid: "dateUnderpaid",
  pending_payment: "datePaid",
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
const FIRST_NOTIFY_STATUSES = ["paid"] as const;
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

  // build mapping of target(B) -> source(A) by organization
  const { rows: cpRows } = await pool.query(
    `SELECT "productId",quantity,"affiliateProductId","unitPrice"
       FROM "cartProducts" WHERE "cartId" = $1`, [o.cartId]);
  if (!cpRows.length) return;

  type MapItem = { organizationId: string; shareLinkId: string; sourceProductId: string; targetProductId: string; };
  async function firstHop(): Promise<MapItem[]> {
    const out: MapItem[] = [];
    for (const ln of cpRows) {
      if (!ln.productId) continue;
      const { rows: [m] } = await pool.query(
        `SELECT "shareLinkId","sourceProductId","targetProductId"
           FROM "sharedProductMapping" WHERE "targetProductId" = $1 LIMIT 1`,
        [ln.productId],
      );
      if (!m) continue;
      const { rows: [prod] } = await pool.query(
        `SELECT "organizationId" FROM products WHERE id = $1`,
        [m.sourceProductId],
      );
      if (!prod) continue;
      out.push({ organizationId: prod.organizationId, ...m });
    }
    return out;
  }
  async function nextHopFrom(items: MapItem[]): Promise<MapItem[]> {
    const out: MapItem[] = [];
    for (const it of items) {
      const { rows: [m] } = await pool.query(
        `SELECT "shareLinkId","sourceProductId","targetProductId"
           FROM "sharedProductMapping" WHERE "targetProductId" = $1 LIMIT 1`,
        [it.sourceProductId],
      );
      if (!m) continue;
      const { rows: [prod] } = await pool.query(
        `SELECT "organizationId" FROM products WHERE id = $1`,
        [m.sourceProductId],
      );
      if (!prod) continue;
      out.push({ organizationId: prod.organizationId, ...m, targetProductId: it.targetProductId });
    }
    return out;
  }

  // collect full chain and group by org
  let frontier = await firstHop();
  const all: MapItem[] = [];
  let depth = 0;
  while (frontier.length && depth++ < 5) {
    all.push(...frontier);
    frontier = await nextHopFrom(frontier);
  }
  if (!all.length) return;
  const byOrg: Record<string, MapItem[]> = {};
  for (const it of all) (byOrg[it.organizationId] ??= []).push(it);
  const entries = Object.entries(byOrg);

  // NOTE: when backfilling missing S-orders after the fact,
  // do NOT re-split shipping; assign 0 shipping to new siblings.

  for (let i = 0; i < entries.length; i++) {
    const [orgId, items] = entries[i];
    // skip orgs that already have an S-<key> order
    const { rowCount: exists } = await pool.query(
      `SELECT 1 FROM orders WHERE "orderKey" = ('S-' || $1) AND "organizationId" = $2 LIMIT 1`,
      [baseKey, orgId],
    );
    if (exists) continue;

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
    // backfill: set shippingShare = 0 to avoid double-charging shipping
    let shippingShare = 0;
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
        supplierOrderId, orgId, supplierClientId, supplierCartId, o.country, 'dropshipping',
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

    // Identify supplier (shared) orders once and reuse everywhere.
    // Sibling cascade and early admin notifications rely on this.
    const isSupplierOrder = String(ord.orderKey ?? "").startsWith("S-");

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
      if (!released) { client.release(); released = true; }
      return NextResponse.json({
        id,
        status: ord.status,
        warnings: ["No status change; skipped side-effects"],
      });
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

    // ─────────────────────────────────────────────────────────────
    // Rules engine hook (BASE order only): run after commit
    // ─────────────────────────────────────────────────────────────
    try {
      const eventMap: Record<string,
        | "order_placed" | "order_partially_paid" | "order_pending_payment"
        | "order_paid"   | "order_completed"      | "order_cancelled" | "order_refunded"
      > = { open: "order_placed", underpaid: "order_partially_paid", pending_payment: "order_pending_payment",
            paid: "order_paid", completed: "order_completed", cancelled: "order_cancelled", refunded: "order_refunded" };
      const orderCurrency = currencyFromCountry(ord.country);
      await processAutomationRules({
        organizationId, event: eventMap[newStatus], country: ord.country ?? null, orderCurrency,
        variables: { order_id: id, order_number: ord.orderKey, order_status: newStatus, order_currency: orderCurrency },
        clientId: ord.clientId ?? null, userId: null, url: `/orders/${id}` });
    } catch (e) { console.warn("[rules] base order hook failed", e); }

    // 🔔 Notify the BASE order (merchant) too (only for base orders)
    if (!isSupplierOrder) {
      try {
        const notifTypeMap: Record<string, NotificationType> = {
          open: "order_placed",
          underpaid: "order_partially_paid",
          pending_payment: "order_pending_payment",
          paid: "order_paid",
          completed: "order_completed",
          cancelled: "order_cancelled",
          refunded: "order_refunded",
        };

        // keep once-only semantics for PAID/COMPLETED via notifiedPaidOrCompleted;
        // allow PENDING_PAYMENT separately (we'll not set the flag for pending).
        const shouldNotify =
          newStatus === "paid" || newStatus === "completed"
            ? !ord.notifiedPaidOrCompleted
            : newStatus === "pending_payment" ||
              newStatus === "cancelled" ||
              newStatus === "refunded";

        if (shouldNotify) {
          const productList = await buildProductListForCart(ord.cartId);
          const orderDate = new Date(ord.dateCreated).toLocaleDateString("en-GB");
          await enqueueNotificationFanout({
            organizationId,
            orderId: id,
            type: notifTypeMap[newStatus],
            trigger: "admin_only",
            channels: ["in_app", "telegram"],
            dedupeSalt: `merchant_admin:${newStatus}`,
            payload: {
              message: `Order #${ord.orderKey} is now <b>${newStatus}</b><br>{product_list}`,
              subject: `Order #${ord.orderKey} ${newStatus}`,
              variables: {
                product_list: productList,
                order_number: ord.orderKey,
                order_date: orderDate,
                order_shipping_method: ord.shippingMethod ?? "-",
                tracking_number: ord.trackingNumber ?? "",
                shipping_company: ord.shippingService ?? "",
              },
              country: ord.country,
              clientId: null,
              userId: null,
              url: `/orders/${id}`,
            },
          });
          // Optional: email the buyer when completed (matches your sibling logic)
          if (newStatus === "completed") {
            await enqueueNotificationFanout({
              organizationId,
              orderId: id,
              type: "order_completed",
              trigger: "user_only_email",
              channels: ["email"],
              dedupeSalt: `buyer_email:${newStatus}`,
              payload: {
                message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
                subject: `Order #${ord.orderKey} ${newStatus}`,
                variables: {
                  product_list: productList,
                  order_number: ord.orderKey,
                  order_date: orderDate,
                  order_shipping_method: ord.shippingMethod ?? "-",
                  tracking_number: ord.trackingNumber ?? "",
                  shipping_company: ord.shippingService ?? "",
                },
                country: ord.country,
                clientId: ord.clientId,
                userId: null,
                url: `/orders/${id}`,
              },
            });
          }
          if (newStatus === "paid" || newStatus === "completed") {
            await pool.query(
              `UPDATE orders SET "notifiedPaidOrCompleted" = TRUE WHERE id = $1 AND "notifiedPaidOrCompleted" = FALSE`,
              [id],
            );
          }
        }
      } catch (e) {
        console.warn("[change-status] enqueue (base order) failed", e);
      }
    }

    // 🔒 One-way cascade: only from base (dropshipper) → supplier(s)
    if (!isSupplierOrder) {
      // Ensure supplier orders exist before we cascade the status
      try { await ensureSupplierOrdersExist(id); } catch (e) { console.warn("[ensureSupplierOrders] failed:", e); }
      /* ────────────────────────────────────────────────────────────
       * Cascade status to supplier “split” orders (baseKey and S-baseKey)
       * – normalize orderKey so 123 and S-123 are siblings
       * – update status + date cols on siblings
       * – after cascade to PAID or PENDING_PAYMENT, also generate revenue for siblings
       * ─────────────────────────────────────────────────────────── */
      const CASCADE_STATUSES = new Set(["pending_payment", "paid", "cancelled", "refunded", "completed"]);
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
          pending_payment: "order_pending_payment",
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
            newStatus === "paid" ||
              newStatus === "pending_payment" ||
              newStatus === "completed"
              ? !sb.notified
              : newStatus === "cancelled" || newStatus === "refunded";

          if (!should) continue;

          // ─────────────────────────────────────────────────────
          // Rules engine hook (SUPPLIER sibling): after cascade
          // ─────────────────────────────────────────────────────
          try {
            const eventMap: Record<string,
              | "order_placed" | "order_partially_paid" | "order_pending_payment"
              | "order_paid"   | "order_completed"      | "order_cancelled" | "order_refunded"
            > = { open: "order_placed", underpaid: "order_partially_paid", pending_payment: "order_pending_payment",
                  paid: "order_paid", completed: "order_completed", cancelled: "order_cancelled", refunded: "order_refunded" };
            const sbCurrency = currencyFromCountry(sb.country);
            await processAutomationRules({
              organizationId: sb.organizationId, event: eventMap[newStatus], country: sb.country, orderCurrency: sbCurrency,
              variables: { order_id: sb.id, order_number: sb.orderKey, order_status: newStatus, order_currency: sbCurrency },
              clientId: sb.clientId ?? null, userId: null, url: `/orders/${sb.id}` });
          } catch (e) { console.warn("[rules] supplier sibling hook failed", sb.id, e); }

          const productList = await buildProductListForCart(sb.cartId);
          const orderDate = new Date(sb.dateCreated).toLocaleDateString("en-GB");

          try {
            await enqueueNotificationFanout({
              organizationId: sb.organizationId,
              orderId: sb.id,
              type: notifTypeMap[newStatus],
              trigger: "admin_only",
              channels: ["in_app", "telegram"],
              dedupeSalt: `supplier_admin:${newStatus}`,
              payload: {
                message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
                subject: `Order #${sb.orderKey} ${newStatus}`,
                variables: {
                  product_list: productList,
                  order_number: sb.orderKey,
                  order_date: orderDate,
                  order_shipping_method: sb.shippingMethod ?? "-",
                  tracking_number: sb.trackingNumber ?? "",
                  shipping_company: sb.shippingService ?? "",
                },
                country: sb.country,
                clientId: null,
                userId: null,
                url: `/orders/${sb.id}`,
              },
            });
            if (newStatus === "completed") {
              await enqueueNotificationFanout({
                organizationId: sb.organizationId,
                orderId: sb.id,
                type: notifTypeMap[newStatus],
                trigger: "user_only_email",
                channels: ["email"],
                dedupeSalt: `supplier_buyer:${newStatus}`,
                payload: {
                  message: `Your order status is now <b>${newStatus}</b><br>{product_list}`,
                  subject: `Order #${sb.orderKey} ${newStatus}`,
                  variables: {
                    product_list: productList,
                    order_number: sb.orderKey,
                    order_date: orderDate,
                    order_shipping_method: sb.shippingMethod ?? "-",
                    tracking_number: sb.trackingNumber ?? "",
                    shipping_company: sb.shippingService ?? "",
                  },
                  country: sb.country,
                  clientId: sb.clientId,
                  userId: null,
                  url: `/orders/${sb.id}`,
                },
              });
            }
          } catch (e) {
            console.warn("[cascade][enqueue] failed for supplier sibling", sb.id, e);
            continue;
          }
        }
      })();


      // Generate revenue for siblings when they become PAID or PENDING_PAYMENT as part of the cascade
      if (newStatus === "paid" || newStatus === "pending_payment") {
        const { rows: sibs } = await pool.query(
          `SELECT id, "organizationId"
         FROM orders
        WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
          AND id <> $2
          AND status IN ('paid','pending_payment')`,
          [baseKey, id],
        );
        await Promise.allSettled(
          sibs.map((s) => getRevenue(s.id, s.organizationId))
        );

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

      // On cancel/refund, flag sibling revenues appropriately
      if (newStatus === "cancelled") {
        await pool.query(
          `UPDATE "orderRevenue"
           SET cancelled = TRUE, refunded = FALSE, "updatedAt" = NOW()
         WHERE "orderId" IN (
           SELECT id FROM orders
            WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
         )`,
          [baseKey]
        );
      } else if (newStatus === "refunded") {
        await pool.query(
          `UPDATE "orderRevenue"
           SET cancelled = FALSE, refunded = TRUE, "updatedAt" = NOW()
         WHERE "orderId" IN (
           SELECT id FROM orders
            WHERE ( "orderKey" = $1 OR "orderKey" = ('S-' || $1) )
         )`,
          [baseKey]
        );
      }
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
    if (
      (newStatus === "paid" || newStatus === "pending_payment") &&
      (ord.status !== "paid" && ord.status !== "pending_payment")
    ) {
      try {
        // 1) update revenue (await to ensure it actually happens before the function exits)
        try {
          await getRevenue(id, organizationId);
        } catch (e) {
          console.warn("[revenue] failed:", e);
        }

        // 2) capture platform fee via internal API
        const feesUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/order-fees`;
        console.log(`[fees] POST → ${feesUrl}`, {
          orderId: id,
          orgId: organizationId,
          hasSecret: Boolean(process.env.INTERNAL_API_SECRET),
        });
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (process.env.INTERNAL_API_SECRET) {
          headers["x-internal-secret"] = process.env.INTERNAL_API_SECRET;
        }
        const feeRes = await fetch(feesUrl, {
          method: "POST",
          headers,
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
    if (newStatus === "cancelled") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = TRUE, refunded = FALSE, "updatedAt" = NOW() WHERE "orderId" = $1 RETURNING *`
        await pool.query(statusQuery, [id])
      } catch (err) {
        console.error(
          `Failed to update revenue for order ${id}:`,
          err
        );
      }
    }

    if (newStatus === "refunded") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = FALSE, refunded = TRUE, "updatedAt" = NOW() WHERE "orderId" = $1 RETURNING *`
        await pool.query(statusQuery, [id])
      } catch (err) {
        console.error(
          `Failed to update revenue for order ${id}:`,
          err
        );
      }
    }

    if (newStatus !== "refunded" && newStatus !== "cancelled") {
      try {
        const statusQuery = `UPDATE "orderRevenue" SET cancelled = FALSE, refunded = FALSE, "updatedAt" = NOW() WHERE "orderId" = $1 RETURNING *`
        await pool.query(statusQuery, [id])
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

    /* order placed */
    if (newStatus === "open" && ord.status !== "open") {
      shouldNotify = true;
    } else if (newStatus === "underpaid") {
      shouldNotify = true;
    } else if (newStatus === "pending_payment") {
      // notify on status change (separate template)
      shouldNotify = true;
    } else if (newStatus === "paid") {
      // de-dupe paid once
      shouldNotify = !ord.notifiedPaidOrCompleted;
    } else if (newStatus === "completed") {
      // ALWAYS notify buyer on completed
      shouldNotify = true;
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
        pending_payment: "order_pending_payment",
        paid: "order_paid",
        completed: "order_completed",
        cancelled: "order_cancelled",
        refunded: "order_refunded",
      } as const;
      const notifType: NotificationType =
        (notifTypeMap as Record<string, NotificationType | undefined>)[newStatus] ??
        "order_message";

      const orderDate = new Date(ord.dateCreated).toLocaleDateString("en-GB");
      // statuses that should alert store admins for buyer orders
      const ADMIN_ALERT_STATUSES = new Set(["underpaid", "pending_payment", "paid", "completed", "cancelled", "refunded"]);
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
        await enqueueNotificationFanout({
          organizationId,
          orderId: id,
          type: notifType,
          trigger: "admin_only",
          channels: ["in_app", "telegram"],
          dedupeSalt: `supplier_admin:${newStatus}`,
          payload: {
            message: baseNotificationPayload.message,
            subject: baseNotificationPayload.subject,
            variables: baseNotificationPayload.variables,
            country: ord.country,
            clientId: null,
            userId: null,
            url: `/orders/${id}`,
          },
        });
        if (newStatus === "completed") {
          await enqueueNotificationFanout({
            organizationId,
            orderId: id,
            type: notifType,
            trigger: "user_only_email",
            channels: ["email"],
            dedupeSalt: `supplier_buyer:${newStatus}`,
            payload: {
              message: baseNotificationPayload.message,
              subject: baseNotificationPayload.subject,
              variables: baseNotificationPayload.variables,
              country: ord.country,
              clientId: ord.clientId,
              userId: null,
              url: `/orders/${id}`,
            },
          });
        }
      } else {
        // Normal (buyer) order – notify the buyer as before…
        await enqueueNotificationFanout({
          organizationId,
          orderId: id,
          type: notifType,
          trigger: "order_status_change",
          channels: ["email", "in_app", "telegram"],
          dedupeSalt: `buyer:${newStatus}`,
          payload: {
            message: baseNotificationPayload.message,
            subject: baseNotificationPayload.subject,
            variables: baseNotificationPayload.variables,
            country: ord.country,
            clientId: ord.clientId,
            userId: null,
            url: `/orders/${id}`,
          },
        });
        // …and ALSO notify store admins for key statuses
        if (ADMIN_ALERT_STATUSES.has(newStatus) && adminEligibleOnce) {
          await enqueueNotificationFanout({
            organizationId,
            orderId: id,
            type: notifType,
            trigger: "admin_only",
            channels: ["in_app", "telegram"],
            dedupeSalt: `store_admin:${newStatus}`,
            payload: {
              message: baseNotificationPayload.message,
              subject: baseNotificationPayload.subject,
              variables: baseNotificationPayload.variables,
              country: ord.country,
              clientId: null,
              userId: null,
              url: `/orders/${id}`,
            },
          });
        }
      }

      /* ─────────────────────────────────────────────────────────────
      *  Affiliate / referral bonuses
      *     – ONLY once, when the order first becomes PAID
      * ──────────────────────────────────────────────────────────── */
      if (
        (newStatus === "paid" || newStatus === "pending_payment") &&
        (ord.status !== "paid" && ord.status !== "pending_payment")
      ) {
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

      /* mark as notified only on first PAID or COMPLETED to prevent repeats */
      if (
        (newStatus === "paid" || newStatus === "completed") && !ord.notifiedPaidOrCompleted
      ) {

        await pool.query(
          `UPDATE orders
          SET "notifiedPaidOrCompleted" = TRUE,
              "updatedAt" = NOW()
        WHERE id = $1`,
          [id],
        );
      }
    }

    // Nudge the outbox drain so messages go out immediately.
    try {
      if (process.env.INTERNAL_API_SECRET) {
        // Prod path: background POST
        await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/notifications/drain?limit=12`,
          {
            method: "POST",
            headers: {
              "x-internal-secret": process.env.INTERNAL_API_SECRET,
              "x-vercel-background": "1",
              accept: "application/json",
            },
            keepalive: true,
          }
        ).catch(() => { });
      } else {
        // Dev/staging fallback: run drain inline
        const { drainNotificationOutbox } = await import("@/lib/notification-outbox");
        await drainNotificationOutbox(12);
      }
    } catch {
      /* best-effort */
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
