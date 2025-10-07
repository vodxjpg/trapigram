import { pgPool, pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";

const apiKey = process.env.CURRENCY_LAYER_API_KEY;

// ── diagnostics ──────────────────────────────────────────────
const dbg = (...a: any[]) => console.log("[orderRevenue]", ...a);
if (!process.env.CURRENCY_LAYER_API_KEY)
  console.warn("[orderRevenue] ⚠️  CURRENCY_LAYER_API_KEY is not set");

const euroCountries = [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"
];

const coins: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  USDT: "tether",
  "USDT.ERC20": "tether",
  "USDT.TRC20": "tether",
  USDC: "usd-coin",
  "USDC.ERC20": "usd-coin",
  "USDC.TRC20": "usd-coin",
  "USDC.SOL": "usd-coin",
  "USDC.SPL": "usd-coin",
  "USDC.POLYGON": "usd-coin",
  "USDC.BEP20": "usd-coin",
  "USDC.ARBITRUM": "usd-coin",
  "USDC.OPTIMISM": "usd-coin",
  "USDC.BASE": "usd-coin",
  XRP: "ripple",
  SOL: "solana",
  ADA: "cardano",
  LTC: "litecoin",
  DOT: "polkadot",
  BCH: "bitcoin-cash",
  LINK: "chainlink",
  BNB: "binancecoin",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  XMR: "monero",
};

type CategoryRevenue = {
  categoryId: string;
  price: number;
  cost: number;
  quantity: number;
};

type TransformedCategoryRevenue = {
  categoryId: string;
  total: number;
  cost: number;
};


// small JSON helpers
function readJson(obj: unknown): any {
  if (!obj) return null;
  if (typeof obj === "string") {
    try { return JSON.parse(obj); } catch { return null; }
  }
  if (typeof obj === "object") return obj as any;
  return null;
}
function priceByCountry(mapLike: any, country: string): number {
  const m = readJson(mapLike) || {};
  const v = m?.[country];
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// ── helpers for paid-like behavior ───────────────────────────
const isPaidLike = (status: unknown) =>
  ["paid", "pending_payment", "completed"].includes(
    String(status ?? "").toLowerCase(),
  );

function ensureDate(d: any): Date {
  const dt = d instanceof Date ? d : new Date(d);
  return isNaN(dt.getTime()) ? new Date() : dt;
}

function getPaidLikeDate(order: any): Date {
  const raw =
    order?.datePaid ??
    (isPaidLike(order?.status) ? order?.dateCreated : undefined) ??
    Date.now();
  return ensureDate(raw);
}

async function getRatesForWindow(fromSec: number, toSec: number, paidAt: Date) {
  // try exact window first
  let ex = await pgPool.query(
    `SELECT * FROM "exchangeRate" WHERE date BETWEEN to_timestamp(${fromSec}) AND to_timestamp(${toSec})`,
  );

  let USDEUR = 0;
  let USDGBP = 0;

  if (ex.rows.length === 0) {
    // pull live + cache
    const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
    const res = await fetch(url);
    dbg("CurrencyLayer ←", res.status, res.statusText);
    const data = await res.json();
    const usdEur = data?.quotes?.USDEUR;
    const usdGbp = data?.quotes?.USDGBP;
    if (usdEur == null || usdGbp == null) {
      return { error: "Invalid API response" };
    }
    const insertSql = `
      INSERT INTO "exchangeRate" ("EUR","GBP", date)
      VALUES ($1, $2, $3)
      RETURNING *`;
    const values = [usdEur, usdGbp, paidAt];
    const inserted = await pgPool.query(insertSql, values);
    USDEUR = Number(inserted.rows[0].EUR);
    USDGBP = Number(inserted.rows[0].GBP);
  } else {
    USDEUR = Number(ex.rows[0].EUR);
    USDGBP = Number(ex.rows[0].GBP);
  }

  return { USDEUR, USDGBP };
}

export async function getRevenue(id: string, organizationId: string) {
  try {
    // 0) idempotency: skip if exists
    const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`;
    const resultCheck = await pool.query(checkQuery);
    const existing = resultCheck.rows;
    if (existing.length > 0) {
      dbg("revenue-already-exists", { orderId: id, rows: existing.length });
      return existing[0];
    }

    // 1) load order
    const orderQuery = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`;
    const resultOrders = await pool.query(orderQuery);
    const order = resultOrders.rows[0];
    if (!order) {
      dbg("order-not-found", { id, organizationId });
      throw new Error("Order not found");
    }

    const cartId = order.cartId;
    const paymentType = String(order.paymentMethod || "").toLowerCase();
    const country = order.country;

    // paid-like moment (supports pending_payment)
    const paidAt = getPaidLikeDate(order);
    const to = Math.floor(paidAt.getTime() / 1000);
    const from = to - 3600;

        // products (first-party + affiliate) – include variationId and unitPrice
    const productResult = await pool.query(
      `SELECT p.*, cp.quantity, cp."variationId", cp."unitPrice"
         FROM "cartProducts" cp
         JOIN products p ON cp."productId" = p.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const products = productResult.rows;

    const affiliateResult = await pool.query(
      `SELECT ap.*, cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN "affiliateProducts" ap ON cp."affiliateProductId" = ap.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const affiliate = affiliateResult.rows;

    // categories
        const categoryResult = await pool.query(
      `SELECT cp."quantity", cp."variationId", cp."unitPrice",
              p."id" AS "productId", p."regularPrice", p."price", p."cost",
              pc."categoryId"
         FROM "cartProducts" AS cp
         JOIN "products"      AS p  ON cp."productId" = p."id"
    LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const categoryData = categoryResult.rows;

        // ── variation-aware effective cost resolver (shared/normal)
    const mappingCache = new Map<
      string,
      { shareLinkId: string; sourceProductId: string } | null
    >();
    const varMapCache = new Map<string, string | null>(); // key: share|src|tgt|tgtVar → srcVar
    const costCache = new Map<string, number>();          // key: productId:variationId:country

    async function mapTargetToSourceVariation(
      shareLinkId: string,
      sourceProductId: string,
      targetProductId: string,
      targetVariationId: string
    ): Promise<string | null> {
      const key = `${shareLinkId}|${sourceProductId}|${targetProductId}|${targetVariationId}`;
      if (varMapCache.has(key)) return varMapCache.get(key)!;
      const { rows } = await pool.query(
        `SELECT "sourceVariationId"
           FROM "sharedVariationMapping"
          WHERE "shareLinkId"       = $1
            AND "sourceProductId"   = $2
            AND "targetProductId"   = $3
            AND "targetVariationId" = $4
          LIMIT 1`,
        [shareLinkId, sourceProductId, targetProductId, targetVariationId],
      );
      const srcVar = rows[0]?.sourceVariationId ?? null;
      varMapCache.set(key, srcVar);
      return srcVar;
    }

    async function resolveEffectiveCost(productId: string, variationId?: string | null): Promise<number> {
      const cacheKey = `${productId}:${variationId ?? "-"}:${country}`;
      if (costCache.has(cacheKey)) return costCache.get(cacheKey)!;

      // upstream mapping (if this is a shared clone)
      let mapping = mappingCache.get(productId);
      if (mapping === undefined) {
        const { rows } = await pool.query(
          `SELECT "shareLinkId","sourceProductId"
             FROM "sharedProductMapping"
            WHERE "targetProductId" = $1
            LIMIT 1`,
          [productId],
        );
        mapping = rows[0]
          ? { shareLinkId: String(rows[0].shareLinkId), sourceProductId: String(rows[0].sourceProductId) }
          : null;
        mappingCache.set(productId, mapping);
      }

      let eff = 0;
      if (mapping) {
        // try variation cost on the SOURCE product
        if (variationId) {
          const srcVarId = await mapTargetToSourceVariation(
            mapping.shareLinkId, mapping.sourceProductId, productId, variationId
          );
          if (srcVarId) {
            const { rows } = await pool.query(
              `SELECT cost FROM "productVariations" WHERE id = $1 LIMIT 1`,
              [srcVarId],
            );
            eff = priceByCountry(rows[0]?.cost ?? null, country);
          }
        }
        if (!eff) {
          // fallback: shared product-level cost
          const { rows } = await pool.query(
            `SELECT cost
               FROM "sharedProduct"
              WHERE "shareLinkId" = $1 AND "productId" = $2
              LIMIT 1`,
            [mapping.shareLinkId, mapping.sourceProductId],
          );
          eff = priceByCountry(rows[0]?.cost ?? null, country);
        }
      } else {
        // non-shared: use variation cost first, then product cost
        if (variationId) {
          const { rows } = await pool.query(
            `SELECT cost FROM "productVariations" WHERE id = $1 LIMIT 1`,
            [variationId],
          );
          eff = priceByCountry(rows[0]?.cost ?? null, country);
        }
        if (!eff) {
          const { rows } = await pool.query(
            `SELECT cost FROM products WHERE id = $1 LIMIT 1`,
            [productId],
          );
          eff = priceByCountry(rows[0]?.cost ?? null, country);
        }
      }

      costCache.set(cacheKey, eff);
      return eff;
    }

    const categories: CategoryRevenue[] = [];
    for (const ct of categoryData) {
      // Prefer actual unit price used at checkout; fallback to catalog price maps
      const price =
        Number(ct.unitPrice ?? NaN) ||
        priceByCountry(ct.regularPrice ?? ct.price ?? null, country) ||
        0;
      const effCost = await resolveEffectiveCost(String(ct.productId), ct.variationId ?? null);
      categories.push({
        categoryId: ct.categoryId,
        price,
        cost: effCost,
        quantity: Number(ct.quantity ?? 0),
      });
    }
    const newCategories: TransformedCategoryRevenue[] = categories.map(
      ({ categoryId, price, cost, quantity }) => ({
        categoryId,
        total: Number(price || 0) * Number(quantity || 0),
        cost: Number(cost || 0) * Number(quantity || 0),
      }),
    );

    // Total cost: first-party via effective (variation-aware) cost, affiliate by native cost map
    const productsCost = await (async () => {
      let sum = 0;
      for (const p of products) {
        const unit = await resolveEffectiveCost(String(p.id), p.variationId ?? null);
        sum += unit * Number(p.quantity ?? 0);
      }
      return sum;
    })();
    const affiliateCost = affiliate.reduce((sum: number, a: any) => {
      const unit = priceByCountry(a?.cost ?? null, country);
      const qty = Number(a?.quantity ?? 0);
      return sum + unit * qty;
    }, 0);
    const totalCost = productsCost + affiliateCost;

    // 2) get exchange rates for that window (used in both branches)
    const needRates = async () => {
      const r = await getRatesForWindow(from, to, paidAt);
      if ("error" in r) throw new Error(r.error as string);
      return r as { USDEUR: number; USDGBP: number };
    };

    // 3) Payment paths
    if (paymentType === "niftipay") {
      // Try to read crypto asset from meta: prefer "paid" event, fallback to "pending_payment"
      const meta = Array.isArray(order.orderMeta)
        ? order.orderMeta
        : (() => {
          try { return JSON.parse(order.orderMeta ?? "[]"); } catch { return []; }
        })();
      const paidEntry =
        meta.find((it: any) => it?.event === "paid") ??
        meta.find((it: any) => it?.event === "pending_payment");

      let coinRaw = "";
      let amount = 0;
      if (paidEntry) {
        coinRaw = paidEntry?.order?.asset ?? "";
        amount = Number(paidEntry?.order?.amount ?? 0);
      }

      const coinKey = coinRaw.toUpperCase();
      const coinId = coins[coinKey];
      if (!coinId) {
        console.warn("[orderRevenue] ⚠️ unsupported asset:", coinKey);
        throw new Error(`Unsupported crypto asset "${coinKey}"`);
      }

      // price snapshot around paid-like time
      const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
      const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
      dbg("CoinGecko ←", res.status, res.statusText);
      if (!res.ok) throw new Error(`HTTP ${res.status} – ${res.statusText}`);

      const result = await res.json();
      const price = Number(result?.prices?.[0]?.[1] ?? 0);
      const totalCryptoUSD = amount * price;

      const { USDEUR, USDGBP } = await needRates();
      const revenueId = uuidv4();

      if (country === "GB") {
        const discountGBP = Number(order.discountTotal || 0);
        const shippingGBP = Number(order.shippingTotal || 0);
        const costGBP = Number(totalCost || 0);
        // base conversions from GBP
        let totalGBP = Number(order.totalAmount || 0);
        let totalUSD = totalGBP / USDGBP;
        let totalEUR = totalGBP * (USDEUR / USDGBP);

        // override totals with crypto valuation
        totalUSD = totalCryptoUSD;
        totalGBP = totalCryptoUSD * USDGBP;
        totalEUR = totalCryptoUSD * USDEUR;

        const discountUSD = discountGBP / USDGBP;
        const shippingUSD = shippingGBP / USDGBP;
        const costUSD = costGBP / USDGBP;

        const discountEUR = discountGBP * (USDEUR / USDGBP);
        const shippingEUR = shippingGBP * (USDEUR / USDGBP);
        const costEUR = costGBP * (USDEUR / USDGBP);

        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        // category splits
        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${(ct.total / USDGBP).toFixed(2)},${(ct.cost / USDGBP).toFixed(2)},
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            ${(ct.total * (USDEUR / USDGBP)).toFixed(2)},${(ct.cost * (USDEUR / USDGBP)).toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      } else if (euroCountries.includes(country)) {
        const discountEUR = Number(order.discountTotal || 0);
        const shippingEUR = Number(order.shippingTotal || 0);
        const costEUR = Number(totalCost || 0);
        let totalEUR = Number(order.totalAmount || 0);

        // override totals with crypto valuation
        const totalUSD = totalCryptoUSD;
        totalEUR = totalCryptoUSD * USDEUR;
        const totalGBP = totalCryptoUSD * USDGBP;

        const discountUSD = discountEUR / USDEUR;
        const shippingUSD = shippingEUR / USDEUR;
        const costUSD = costEUR / USDEUR;

        const discountGBP = discountEUR * (USDGBP / USDEUR);
        const shippingGBP = shippingEUR * (USDGBP / USDEUR);
        const costGBP = costEUR * (USDGBP / USDEUR);

        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${(ct.total / USDEUR).toFixed(2)},${(ct.cost / USDEUR).toFixed(2)},
            ${(ct.total * (USDGBP / USDEUR)).toFixed(2)},${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      } else {
        const discountUSD = Number(order.discountTotal || 0);
        const shippingUSD = Number(order.shippingTotal || 0);
        const costUSD = Number(totalCost || 0);
        let totalUSD = Number(order.totalAmount || 0);

        // override with crypto USD
        totalUSD = totalCryptoUSD;
        const { USDEUR, USDGBP } = await needRates();
        const totalEUR = totalUSD * USDEUR;
        const totalGBP = totalUSD * USDGBP;

        const discountEUR = discountUSD * USDEUR;
        const shippingEUR = shippingUSD * USDEUR;
        const costEUR = costUSD * USDEUR;

        const discountGBP = discountUSD * USDGBP;
        const shippingGBP = shippingUSD * USDGBP;
        const costGBP = costUSD * USDGBP;

        const revenueId = uuidv4();
        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            ${(ct.total * USDGBP).toFixed(2)},${(ct.cost * USDGBP).toFixed(2)},
            ${(ct.total * USDEUR).toFixed(2)},${(ct.cost * USDEUR).toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      }
    } else {
      // Non-crypto payments
      const { USDEUR, USDGBP } = await needRates();
      const revenueId = uuidv4();

      if (country === "GB") {
        const totalGBP = Number(order.totalAmount || 0);
        const shippingGBP = Number(order.shippingTotal || 0);
        const discountGBP = Number(order.discountTotal || 0);
        const costGBP = Number(totalCost || 0);

        const discountUSD = discountGBP / USDGBP;
        const shippingUSD = shippingGBP / USDGBP;
        const costUSD = costGBP / USDGBP;
        const totalUSD = totalGBP / USDGBP;

        const discountEUR = discountGBP * (USDEUR / USDGBP);
        const shippingEUR = shippingGBP * (USDEUR / USDGBP);
        const costEUR = costGBP * (USDEUR / USDGBP);
        const totalEUR = totalGBP * (USDEUR / USDGBP);

        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${(ct.total / USDGBP).toFixed(2)},${(ct.cost / USDGBP).toFixed(2)},
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            ${(ct.total * (USDEUR / USDGBP)).toFixed(2)},${(ct.cost * (USDEUR / USDGBP)).toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      } else if (euroCountries.includes(country)) {
        const totalEUR = Number(order.totalAmount || 0);
        const shippingEUR = Number(order.shippingTotal || 0);
        const discountEUR = Number(order.discountTotal || 0);
        const costEUR = Number(totalCost || 0);

        const discountGBP = discountEUR * (USDGBP / USDEUR);
        const shippingGBP = shippingEUR * (USDGBP / USDEUR);
        const costGBP = costEUR * (USDGBP / USDEUR);
        const totalGBP = totalEUR * (USDGBP / USDEUR);

        const discountUSD = discountEUR / USDEUR;
        const shippingUSD = shippingEUR / USDEUR;
        const costUSD = costEUR / USDEUR;
        const totalUSD = totalEUR / USDEUR;

        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${(ct.total / USDEUR).toFixed(2)},${(ct.cost / USDEUR).toFixed(2)},
            ${(ct.total * (USDGBP / USDEUR)).toFixed(2)},${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      } else {
        const discountUSD = Number(order.discountTotal || 0);
        const shippingUSD = Number(order.shippingTotal || 0);
        const totalUSD = Number(order.totalAmount || 0);
        const costUSD = Number(totalCost || 0);

        const discountEUR = discountUSD * USDEUR;
        const shippingEUR = shippingUSD * USDEUR;
        const costEUR = costUSD * USDEUR;
        const totalEUR = totalUSD * USDEUR;

        const discountGBP = discountUSD * USDGBP;
        const shippingGBP = shippingUSD * USDGBP;
        const costGBP = costUSD * USDGBP;
        const totalGBP = totalUSD * USDGBP;

        const q = `INSERT INTO "orderRevenue"(id,"orderId",
          "USDtotal","USDdiscount","USDshipping","USDcost",
          "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
          "EURtotal","EURdiscount","EURshipping","EURcost",
          "createdAt","updatedAt","organizationId")
        VALUES('${revenueId}','${id}',
          ${totalUSD.toFixed(2)},${discountUSD.toFixed(2)},${shippingUSD.toFixed(2)},${costUSD.toFixed(2)},
          ${totalGBP.toFixed(2)},${discountGBP.toFixed(2)},${shippingGBP.toFixed(2)},${costGBP.toFixed(2)},
          ${totalEUR.toFixed(2)},${discountEUR.toFixed(2)},${shippingEUR.toFixed(2)},${costEUR.toFixed(2)},
          NOW(),NOW(),'${organizationId}')
        RETURNING *`;
        const inserted = await pool.query(q);
        const revenue = inserted.rows[0];

        for (const ct of newCategories) {
          const catRevenueId = uuidv4();
          const cq = `INSERT INTO "categoryRevenue"(id,"categoryId",
            "USDtotal","USDcost",
            "GBPtotal","GBPcost",
            "EURtotal","EURcost",
            "createdAt","updatedAt","organizationId")
          VALUES('${catRevenueId}','${ct.categoryId}',
            ${ct.total.toFixed(2)},${ct.cost.toFixed(2)},
            ${(ct.total * USDGBP).toFixed(2)},${(ct.cost * USDGBP).toFixed(2)},
            ${(ct.total * USDEUR).toFixed(2)},${(ct.cost * USDEUR).toFixed(2)},
            NOW(),NOW(),'${organizationId}')`;
          await pool.query(cq);
        }
        return revenue;
      }
    }
  } catch (error) {
    return error;
  }
}
