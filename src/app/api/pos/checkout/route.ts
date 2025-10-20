// src/app/api/pos/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { enqueueNotificationFanout } from "@/lib/notification-outbox";
import { emitIdleForCart } from "@/lib/customer-display-emit";

/* ========= Revenue helpers (inlined) ========= */

// Small helper: fetch with timeout + JSON parse
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

const euroCountries = [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT",
  "NL", "PT", "SK", "SI", "ES"
];

const currencyFromCountry = (c: string) =>
  c === "GB" ? "GBP" : euroCountries.includes(c) ? "EUR" : "USD";

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
  return rows[0];
}

async function insertCategoryRevenue(
  catRevenueId: string,
  categoryId: string,
  organizationId: string,
  v: {
    USDtotal: number; USDcost: number;
    GBPtotal: number; GBPcost: number;
    EURtotal: number; EURcost: number;
  }
) {
  const sql = `INSERT INTO "categoryRevenue" (id,"categoryId","USDtotal","USDcost","GBPtotal","GBPcost","EURtotal","EURcost","createdAt","updatedAt","organizationId")
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),$9)`;
  await pool.query(sql, [catRevenueId, categoryId, v.USDtotal, v.USDcost, v.GBPtotal, v.GBPcost, v.EURtotal, v.EURcost, organizationId]);
}

async function getRevenue(id: string, organizationId: string) {
  const apiKey = process.env.CURRENCY_LAYER_API_KEY;
  // 0) avoid duplicates
  const { rows: existing } = await pool.query(
    `SELECT * FROM "orderRevenue" WHERE "orderId"=$1 LIMIT 1`, [id]
  );
  if (existing.length) return existing[0];

  // 1) order
  const { rows: orderRows } = await pool.query(
    `SELECT * FROM orders WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
    [id, organizationId]
  );
  const order: any = orderRows[0];
  if (!order) throw new Error("Order not found");

  const cartId: string = order.cartId;
  const paymentType = String(order.paymentMethod ?? "").toLowerCase();
  const country: string = order.country;

  // effective cost resolver (shared/variation aware)
  const mappingCache = new Map<string, { shareLinkId: string; sourceProductId: string } | null>();
  const varMapCache = new Map<string, string | null>();
  const costCache = new Map<string, number>();

  async function mapTargetToSourceVariation(
    shareLinkId: string,
    sourceProductId: string,
    targetProductId: string,
    targetVariationId: string
  ) {
    const key = `${shareLinkId}|${sourceProductId}|${targetProductId}|${targetVariationId}`;
    if (varMapCache.has(key)) return varMapCache.get(key)!;
    const { rows } = await pool.query(
      `SELECT "sourceVariationId"
         FROM "sharedVariationMapping"
        WHERE "shareLinkId"=$1
          AND "sourceProductId"=$2
          AND "targetProductId"=$3
          AND "targetVariationId"=$4
        LIMIT 1`,
      [shareLinkId, sourceProductId, targetProductId, targetVariationId],
    );
    const srcVar = rows[0]?.sourceVariationId ?? null;
    varMapCache.set(key, srcVar);
    return srcVar;
  }

  async function resolveEffectiveCost(productId: string, variationId?: string | null) {
    const cacheKey = `${productId}:${variationId ?? "-"}:${country}`;
    if (costCache.has(cacheKey)) return costCache.get(cacheKey)!;

    let mapping = mappingCache.get(productId);
    if (mapping === undefined) {
      const { rows: [m] } = await pool.query(
        `SELECT "shareLinkId","sourceProductId"
           FROM "sharedProductMapping"
          WHERE "targetProductId"=$1
          LIMIT 1`,
        [productId],
      );
      mapping = m ? { shareLinkId: m.shareLinkId, sourceProductId: m.sourceProductId } : null;
      mappingCache.set(productId, mapping);
    }

    let eff = 0;
    if (mapping) {
      let srcVarId: string | null = null;
      if (variationId) {
        srcVarId = await mapTargetToSourceVariation(
          mapping.shareLinkId, mapping.sourceProductId, productId, variationId,
        );
      }
      if (srcVarId) {
        const { rows: [pv] } = await pool.query(
          `SELECT cost FROM "productVariations" WHERE id=$1 LIMIT 1`,
          [srcVarId],
        );
        eff = Number((pv?.cost ?? {})[country] ?? 0);
      }
      if (!eff) {
        const { rows: [sp] } = await pool.query(
          `SELECT cost FROM "sharedProduct"
             WHERE "shareLinkId"=$1 AND "productId"=$2 LIMIT 1`,
          [mapping.shareLinkId, mapping.sourceProductId],
        );
        eff = Number((sp?.cost ?? {})[country] ?? 0);
      }
    } else {
      if (variationId) {
        const { rows: [pv] } = await pool.query(
          `SELECT cost FROM "productVariations" WHERE id=$1 LIMIT 1`,
          [variationId],
        );
        eff = Number((pv?.cost ?? {})[country] ?? 0);
      }
      if (!eff) {
        const { rows: [p] } = await pool.query(
          `SELECT cost FROM products WHERE id=$1 LIMIT 1`,
          [productId],
        );
        eff = Number((p?.cost ?? {})[country] ?? 0);
      }
    }

    costCache.set(cacheKey, eff);
    return eff;
  }

  // 3) paid timestamp window for FX/crypto
  const rawPaid = order.datePaid ?? order.dateCreated;
  const paidDate: Date = rawPaid instanceof Date ? rawPaid : new Date(rawPaid);
  if (Number.isNaN(paidDate.getTime())) throw new Error("Invalid paid date");
  const to = Math.floor(paidDate.getTime() / 1000);
  const from = to - 3600;

  // 4) cart lines (normal + affiliate) and categories
  const { rows: prodRows } = await pool.query(
    `SELECT p.*, cp.quantity, cp."unitPrice"
       FROM "cartProducts" cp
       JOIN products p ON cp."productId"=p.id
      WHERE cp."cartId"=$1`,
    [cartId],
  );
  const { rows: affRows } = await pool.query(
    `SELECT ap.*, cp.quantity, cp."unitPrice"
       FROM "cartProducts" cp
       JOIN "affiliateProducts" ap ON cp."affiliateProductId"=ap.id
      WHERE cp."cartId"=$1`,
    [cartId],
  );

  const { rows: catRows } = await pool.query(
    `SELECT cp.quantity, cp."unitPrice", cp."variationId",
            p."id" AS "productId", pc."categoryId"
       FROM "cartProducts" AS cp
       JOIN products  AS p  ON cp."productId" = p."id"
  LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
      WHERE cp."cartId"=$1`,
    [cartId],
  );

  const categories: CategoryRevenue[] = [];
  for (const ct of catRows) {
    const qty = Number(ct.quantity ?? 0);
    const unitPrice = Number(ct.unitPrice ?? 0);
    const effCost = await resolveEffectiveCost(String(ct.productId), ct.variationId ?? null);
    categories.push({ categoryId: ct.categoryId, price: unitPrice, cost: effCost, quantity: qty });
  }
  const newCategories: TransformedCategoryRevenue[] = categories.map(
    ({ categoryId, price, cost, quantity }) => ({
      categoryId, total: price * quantity, cost: cost * quantity,
    }),
  );

  // 5) total COST
  const productsCost = categories.reduce((s, c) => s + c.cost * c.quantity, 0);
  const affiliateCost = affRows.reduce((s, a: any) => {
    const unitCost = Number(a?.cost?.[country] ?? 0);
    const qty = Number(a?.quantity ?? 0);
    return s + unitCost * qty;
  }, 0);
  const totalCost = productsCost + affiliateCost;

  // 6) crypto override for Niftipay (needs PAID meta)
  let totalUsdFromCrypto = 0;
  let applyCryptoOverride = false;
  let coinRaw = "";
  let amount = 0;
  if (paymentType === "niftipay") {
    const metaArr: any[] = Array.isArray(order.orderMeta)
      ? order.orderMeta
      : JSON.parse(order.orderMeta ?? "[]");
    const paidEntry = metaArr.find((m) => String(m?.event ?? "").toLowerCase() === "paid");
    if (paidEntry) {
      coinRaw = String(paidEntry?.order?.asset ?? "");
      amount = Number(paidEntry?.order?.amount ?? 0);
      applyCryptoOverride = Boolean(coinRaw && amount > 0);
    }
  }
  if (applyCryptoOverride) {
    const coinKey = coinRaw.toUpperCase();
    const coinId = coins[coinKey];
    if (!coinId) throw new Error(`Unsupported crypto asset "${coinKey}"`);
    const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
    const { res: cgRes, data: cgData } = await fetchJSON(url, {
      method: "GET", headers: { accept: "application/json" }, timeoutMs: 5000,
    });
    if (!cgRes.ok) throw new Error(`HTTP ${cgRes.status} – ${cgRes.statusText}`);
    const prices = Array.isArray(cgData?.prices) ? cgData.prices : [];
    const last = prices.length ? prices[prices.length - 1] : null;
    const price = Array.isArray(last) ? Number(last[1]) : null;
    if (price == null || Number.isNaN(price)) throw new Error("No price data from CoinGecko");
    totalUsdFromCrypto = amount * price;
  }

  // 7) FX
  const { rows: fxRows } = await pool.query(
    `SELECT "EUR","GBP" FROM "exchangeRate" WHERE date <= to_timestamp($1) ORDER BY date DESC LIMIT 1`,
    [to],
  );

  let USDEUR = 0, USDGBP = 0;
  if (!fxRows.length) {
    const apiKey = process.env.CURRENCY_LAYER_API_KEY;
    const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
    const { res: clRes, data } = await fetchJSON(url, { timeoutMs: 5000 });
    const usdEur = Number(data?.quotes?.USDEUR ?? 0);
    const usdGbp = Number(data?.quotes?.USDGBP ?? 0);
    if (!(usdEur > 0) || !(usdGbp > 0)) throw new Error("Invalid FX API response");
    const { rows: ins } = await pool.query(
      `INSERT INTO "exchangeRate" ("EUR","GBP",date) VALUES ($1,$2,$3) RETURNING *`,
      [usdEur, usdGbp, new Date(paidDate)],
    );
    USDEUR = Number(ins[0].EUR);
    USDGBP = Number(ins[0].GBP);
  } else {
    USDEUR = Number(fxRows[0].EUR);
    USDGBP = Number(fxRows[0].GBP);
  }

  // 8) compute by native currency
  const revenueId = uuidv4();

  if (country === "GB") {
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

    if (applyCryptoOverride) {
      totalUSD = totalUsdFromCrypto;
      totalEUR = totalUsdFromCrypto * USDEUR;
      totalGBP = totalUsdFromCrypto * USDGBP;
    }

    const revenue = await insertOrderRevenue(revenueId, id, organizationId, {
      USDtotal: totalUSD, USDdiscount: discountUSD, USDshipping: shippingUSD, USDcost: costUSD,
      GBPtotal: totalGBP, GBPdiscount: discountGBP, GBPshipping: shippingGBP, GBPcost: costGBP,
      EURtotal: totalEUR, EURdiscount: discountEUR, EURshipping: shippingEUR, EURcost: costEUR,
    });

    for (const ct of newCategories) {
      const catRevenueId = uuidv4();
      await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
        USDtotal: ct.total / USDGBP, USDcost: ct.cost / USDGBP,
        GBPtotal: ct.total, GBPcost: ct.cost,
        EURtotal: ct.total * (USDEUR / USDGBP), EURcost: ct.cost * (USDEUR / USDGBP),
      });
    }
    return revenue;
  } else if (euroCountries.includes(country)) {
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
      USDtotal: totalUSD, USDdiscount: discountUSD, USDshipping: shippingUSD, USDcost: costUSD,
      GBPtotal: totalGBP, GBPdiscount: discountGBP, GBPshipping: shippingGBP, GBPcost: costGBP,
      EURtotal: totalEUR, EURdiscount: discountEUR, EURshipping: shippingEUR, EURcost: costEUR,
    });

    for (const ct of newCategories) {
      const catRevenueId = uuidv4();
      await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
        USDtotal: ct.total / USDEUR, USDcost: ct.cost / USDEUR,
        GBPtotal: ct.total * (USDGBP / USDEUR), GBPcost: ct.cost * (USDGBP / USDEUR),
        EURtotal: ct.total, EURcost: ct.cost,
      });
    }
    return revenue;
  } else {
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
      USDtotal: totalUSD, USDdiscount: discountUSD, USDshipping: shippingUSD, USDcost: costUSD,
      GBPtotal: totalGBP, GBPdiscount: discountGBP, GBPshipping: shippingGBP, GBPcost: costGBP,
      EURtotal: totalEUR, EURdiscount: discountEUR, EURshipping: shippingEUR, EURcost: costEUR,
    });

    for (const ct of newCategories) {
      const catRevenueId = uuidv4();
      await insertCategoryRevenue(catRevenueId, ct.categoryId, organizationId, {
        USDtotal: ct.total, USDcost: ct.cost,
        GBPtotal: ct.total * USDGBP, GBPcost: ct.cost * USDGBP,
        EURtotal: ct.total * USDEUR, EURcost: ct.cost * USDEUR,
      });
    }
    return revenue;
  }
}

/* -------- helpers -------- */
async function loadCartSummary(cartId: string) {
  const { rows } = await pool.query(
    `SELECT ca.id, ca."clientId", ca.country, ca."cartUpdatedHash", ca.status, ca.channel,
            cl."firstName", cl."lastName", cl.username, cl."levelId"
       FROM carts ca
       JOIN clients cl ON cl.id = ca."clientId"
      WHERE ca.id = $1`,
    [cartId]
  );
  if (!rows.length) return null;

  const c = rows[0];

  // Normalize legacy 'pos' → 'pos-' so startsWith("pos-") checks pass.
  let normalizedChannel: string =
    (typeof c.channel === "string" ? c.channel : "web") || "web";
  if (normalizedChannel.toLowerCase() === "pos") {
    try {
      await pool.query(`UPDATE carts SET channel = $1 WHERE id = $2`, ["pos-", cartId]);
      normalizedChannel = "pos-";
    } catch {
      // best effort; continue
    }
  }

  const clientDisplayName =
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.username ||
    "Customer";

  const { rows: sum } = await pool.query<{ subtotal: string }>(
    `SELECT COALESCE(SUM(quantity * "unitPrice"),0)::numeric AS subtotal
       FROM "cartProducts"
      WHERE "cartId" = $1`,
    [cartId]
  );

  return {
    cartId: c.id as string,
    clientId: c.clientId as string,
    country: c.country as string,
    cartUpdatedHash: c.cartUpdatedHash as string,
    status: !!c.status,
    channel: normalizedChannel,
    clientDisplayName,
    levelId: (c.levelId as string | null) ?? "default",
    subtotal: Number(sum[0]?.subtotal ?? 0),
  };
}

async function activePaymentMethods(tenantId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, active, "default", description, instructions
       FROM "paymentMethods"
      WHERE "tenantId" = $1 AND active = TRUE
      ORDER BY "createdAt" DESC`,
    [tenantId]
  );
  return rows;
}

async function buildProductListForCart(cartId: string) {
  const { rows } = await pool.query(
    `
      SELECT
           cp.quantity,
           COALESCE(
             CASE
               WHEN cp."variationId" IS NOT NULL THEN
                 p.title || ' — ' || 'SKU:' || COALESCE(pv.sku, '')
               ELSE p.title
             END,
             ap.title
           ) AS title,
           COALESCE(cat.name, 'Uncategorised') AS category
      FROM "cartProducts" cp
      LEFT JOIN products p              ON p.id  = cp."productId"
      LEFT JOIN "affiliateProducts" ap  ON ap.id = cp."affiliateProductId"
      LEFT JOIN "productVariations" pv  ON pv.id = cp."variationId"
      LEFT JOIN "productCategory" pc    ON pc."productId" = COALESCE(p.id, ap.id)
      LEFT JOIN "productCategories" cat ON cat.id = pc."categoryId"
     WHERE cp."cartId" = $1
     ORDER BY category, title
    `,
    [cartId],
  );
  const grouped: Record<string, { q: number; t: string }[]> = {};
  for (const r of rows) {
    (grouped[r.category] ??= []).push({ q: r.quantity, t: r.title });
  }
  return Object.entries(grouped)
    .map(([cat, items]) => {
      const lines = items.map((it) => `${it.t} - x${it.q}`).join("<br>");
      return `<b>${cat.toUpperCase()}</b><br><br>${lines}`;
    })
    .join("<br><br>");
}


/* -------- schemas -------- */

const DiscountSchema = z.object({
  type: z.enum(["fixed", "percentage"]),
  value: z.number().nonnegative(),
}).optional();

const CheckoutCreateSchema = z.object({
  cartId: z.string().min(1),
  payments: z.array(
    z.object({ methodId: z.string().min(1), amount: z.number().positive() })
  ).default([]),
  storeId: z.string().optional(),
  registerId: z.string().optional(),
  discount: DiscountSchema,
  parked: z.boolean().optional(),
});

/* Resolve current user (cashier) from the same session */
type MinimalUser = { id: string; name: string | null } | null;
async function fetchCurrentUserFromSession(req: NextRequest): Promise<MinimalUser> {
  try {
    const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
    const res = await fetch(`${origin}/api/users/current`, {
      headers: { cookie: req.headers.get("cookie") ?? "" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const u = data?.user;
    if (!u) return null;
    return { id: u.id, name: u.name ?? null };
  } catch {
    return null;
  }
}

/* GET: summary + ACTIVE payment methods */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId } = ctx as { tenantId: string | null };
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const url = new URL(req.url);
  const cartId = url.searchParams.get("cartId");
  if (!cartId) return NextResponse.json({ error: "cartId is required" }, { status: 400 });

  const summary = await loadCartSummary(cartId);
  if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });

  if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
    return NextResponse.json({ error: "Not a POS cart" }, { status: 400 });
  }

  const methods = await activePaymentMethods(tenantId);
  return NextResponse.json({ summary, paymentMethods: methods }, { status: 200 });
}

/* POST: create order for POS cart (supports split payments) */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  try {
    const { cartId, payments, storeId, registerId, discount, parked } =
      CheckoutCreateSchema.parse(await req.json());
    const isParked = Boolean(parked);
    if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

    const summary = await loadCartSummary(cartId);
    if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    if (!summary.status) return NextResponse.json({ error: "Cart is not active" }, { status: 400 });

    if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
      return NextResponse.json({ error: "Only POS carts can be checked out here" }, { status: 400 });
    }

    const methods = await activePaymentMethods(tenantId);
    if (!methods.length) {
      return NextResponse.json({ error: "No active payment methods configured" }, { status: 400 });
    }
    const activeIds = new Set(methods.map((m: any) => m.id));
    for (const p of payments) {
      if (!activeIds.has(p.methodId)) {
        return NextResponse.json({ error: `Inactive/invalid payment method: ${p.methodId}` }, { status: 400 });
      }
    }

    const shippingTotal = 0;
    const subtotal = Number(summary.subtotal || 0);

    // ── POS discount → coupon "POS"
    let discountTotal = 0;
    let couponCode: string | null = null;
    let couponType: "fixed" | "percentage" | null = null;
    let discountValueArr: string[] = [];
    if (discount && Number.isFinite(discount.value) && discount.value > 0) {
      if (discount.type === "percentage") {
        const pct = Math.max(0, Math.min(100, discount.value));
        discountTotal = +(subtotal * (pct / 100)).toFixed(2);
        couponCode = "POS";
        couponType = "percentage";
        discountValueArr = [String(pct)];
      } else {
        const fixed = Math.max(0, discount.value);
        discountTotal = +Math.min(subtotal, fixed).toFixed(2);
        couponCode = "POS";
        couponType = "fixed";
        discountValueArr = [String(fixed)];
      }
      // keep carts table in sync
      await pool.query(
        `UPDATE carts SET "couponCode" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [couponCode, cartId],
      );
    }

    const totalAmount = +(subtotal + shippingTotal - discountTotal).toFixed(2);
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
    const epsilon = 0.01;

    // For BOTH normal and parked, payments must cover 100% (within epsilon)
    if (Math.abs(paid - totalAmount) > epsilon) {
      return NextResponse.json(
        { error: `Selected payments (${paid.toFixed(2)}) must equal the total (${totalAmount.toFixed(2)}).` },
        { status: 400 }
      );
    }

    const orderId = uuidv4();
    // Sequential POS order number: POS-0001, POS-0002, ...
    // Reuse the global order_key_seq so numbers don't collide across channels.
    await pool.query(
      `CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`
    );
    const { rows: seqRows } = await pool.query(
      `SELECT nextval('order_key_seq') AS seq`
    );
    const seqNum = String(Number(seqRows[0].seq)).padStart(4, "0");
    const orderKey = `POS-${seqNum}`;
    const primaryMethodId = payments[0]?.methodId ?? (methods[0]?.id ?? null)

    let orderChannel = summary.channel;
    if (orderChannel === "pos-" && (storeId || registerId)) {
      orderChannel = `pos-${storeId ?? "na"}-${registerId ?? "na"}`;
      await pool.query(`UPDATE carts SET channel=$1 WHERE id=$2`, [orderChannel, cartId]);
    }


    // Cashier meta event
    const currentUser = await fetchCurrentUserFromSession(req);
    const cashierEvent = {
      event: "cashier",
      type: "pos_checkout",
      cashierId: currentUser?.id ?? (ctx as any).userId ?? null,
      cashierName: currentUser?.name ?? null,
      storeId: storeId ?? null,
      registerId: registerId ?? null,
      at: new Date().toISOString(),
    };
    const metaArr: any[] = [cashierEvent];
    if (isParked) {
      metaArr.push({
        event: "parked",
        remaining: +(totalAmount - paid).toFixed(2),
        total: totalAmount,
        paid: +paid.toFixed(2),
        at: new Date().toISOString(),
      });
    }
    const initialOrderMeta = JSON.stringify(metaArr);

    const orderStatus = isParked ? "pending_payment" : "paid";
    const datePaid = isParked ? null : new Date();
    const dateCompleted = isParked ? null : new Date();

    const insertSql = `
     INSERT INTO orders (
        id,"clientId","cartId",country,status,
        "paymentMethod","orderKey","cartHash",
        "shippingTotal","discountTotal","totalAmount",
        "couponCode","couponType","discountValue",
        "shippingService",
        "dateCreated","datePaid","dateCompleted","dateCancelled",
        "orderMeta",
        "createdAt","updatedAt","organizationId",channel
      ) VALUES (
        $1,$2,$3,$4,$5,
        $6,$7,$8,
        $9,$10,$11,
        $12,$13,$14,
        $15,
        $16,$17,$18,$19,
        $20::jsonb,
        NOW(),NOW(),$21,$22
      )
      RETURNING *`;

    const vals = [
      orderId,
      summary.clientId,
      summary.cartId,
      summary.country,
      orderStatus,                 //  "paid" or "pending payment"
      primaryMethodId,             // may be null → ensure column allows it; otherwise keep methods[0].id
      orderKey,
      summary.cartUpdatedHash,
      shippingTotal,
      discountTotal,
      totalAmount,
      couponCode,
      couponType,
      discountValueArr,
      "-",
      new Date(),                  // dateCreated
      datePaid,     
      dateCompleted,
      null,                        // dateCancelled
      initialOrderMeta,
      organizationId,
      orderChannel,
    ];

    const tx = await pool.connect();
    try {
      await tx.query("BEGIN");
      const { rows: orderRows } = await tx.query(insertSql, vals);
      const order = orderRows[0];

      // persist each split
      for (const p of payments) {
        await tx.query(
          `INSERT INTO "orderPayments"(id,"orderId","methodId",amount)
           VALUES ($1,$2,$3,$4)`,
          [uuidv4(), order.id, p.methodId, Number(p.amount)]
        );
      }

      await tx.query(`UPDATE carts SET status = FALSE, "updatedAt" = NOW() WHERE id = $1`, [cartId]);


      // ⬇️ Create revenue for this POS order
      await tx.query("COMMIT");

      // clear the paired customer display now that the cart is closed
      try { await emitIdleForCart(cartId); } catch (e) { console.warn("[cd][checkout->idle] emit failed", e); }

      // ⬇️ Create revenue for this POS order
      try { await getRevenue(order.id, organizationId); } catch (e) { console.warn("[POS checkout][revenue] failed", e); }

      // ⬇️ Capture platform fee for this POS order (since it begins as "paid")
      try {
        const feesUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/order-fees`;
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (process.env.INTERNAL_API_SECRET) headers["x-internal-secret"] = process.env.INTERNAL_API_SECRET;
        else headers["x-local-invoke"] = "1"; // dev/staging fallback (matches change-status)
        const res = await fetch(feesUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ orderId: order.id }),
        });
        if (!res.ok) {
          console.error(`[fees][pos] ${res.status} ${res.statusText}`, await res.text().catch(() => ""));
        }
      } catch (e) {
        console.warn("[POS checkout][fees] failed", e);
      }

      // ⬇️ Affiliate bonuses (referral + spending) for POS (mirrors change-status paid-like)
      try {
        // 🚫 Skip all affiliate awards for walk-in customers
        const { rows: [who] } = await pool.query(
          `SELECT COALESCE("isWalkIn",FALSE) AS "isWalkIn",
              LOWER(COALESCE("firstName",'')) AS "firstName"
         FROM clients
        WHERE id = $1
        LIMIT 1`,
          [order.clientId],
        );
        const isWalkInCustomer = Boolean(who?.isWalkIn) || (who?.firstName === "walk-in");

        if (!isWalkInCustomer) {
          // 1) settings
          const { rows: [affSet] } = await pool.query(
            `SELECT "pointsPerReferral",
                "spendingNeeded"    AS "spendingStep",
                "pointsPerSpending" AS "pointsPerSpendingStep"
           FROM "affiliateSettings"
          WHERE "organizationId" = $1
          LIMIT 1`,
            [organizationId],
          );
          const ptsPerReferral = Number(affSet?.pointsPerReferral || 0);
          const stepEur = Number(affSet?.spendingStep || 0);
          const ptsPerStep = Number(affSet?.pointsPerSpendingStep || 0);

          // 2) one-time referral award to referrer (if any)
          const { rows: [refFlag] } = await pool.query(
            `SELECT COALESCE("referralAwarded",FALSE) AS awarded FROM orders WHERE id = $1`,
            [order.id],
          );
          const { rows: [cli] } = await pool.query(
            `SELECT "referredBy" FROM clients WHERE id = $1`,
            [order.clientId],
          );
          if (!refFlag?.awarded && cli?.referredBy && ptsPerReferral > 0) {
            await pool.query(
              `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"sourceClientId","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,'referral_bonus','Bonus from referral order',$5,NOW(),NOW())`,
              [uuidv4(), organizationId, cli.referredBy, ptsPerReferral, order.clientId],
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
            await pool.query(
              `UPDATE orders SET "referralAwarded" = TRUE, "updatedAt" = NOW() WHERE id = $1`,
              [order.id],
            );
          }

          // 3) spending milestone bonus for the BUYER
          if (stepEur > 0 && ptsPerStep > 0) {
            // previous lifetime EUR (exclude this new order)
            const { rows: [prevSpent] } = await pool.query(
              `SELECT COALESCE(SUM(r."EURtotal"),0) AS eur
               FROM "orderRevenue" r
               JOIN orders o ON o.id = r."orderId"
              WHERE o."clientId"       = $1
                AND o."organizationId" = $2
                AND o.status IN ('paid','pending_payment','completed')
                AND o.id <> $3`,
              [order.clientId, organizationId, order.id],
            );
            const prevTotalEur = Number(prevSpent?.eur ?? 0);

            // get latest FX (getRevenue just ensured a row exists)
            const { rows: [fx] } = await pool.query(
              `SELECT "EUR","GBP" FROM "exchangeRate" ORDER BY date DESC LIMIT 1`
            );
            let USDEUR = Number(fx?.EUR ?? 1);
            let USDGBP = Number(fx?.GBP ?? 1);
            if (!(USDEUR > 0)) USDEUR = 1;
            if (!(USDGBP > 0)) USDGBP = 1;

            // this order's EUR (from order total + FX)
            const amt = Number(order.totalAmount ?? 0);
            const ctry = String(order.country ?? "");
            const thisOrderEur =
              euroCountries.includes(ctry)
                ? amt
                : (ctry === "GB" ? amt * (USDEUR / USDGBP) : amt * USDEUR);

            // points already granted for spending bonuses
            const { rows: [prev] } = await pool.query(
              `SELECT COALESCE(SUM(points),0) AS pts
               FROM "affiliatePointLogs"
              WHERE "organizationId" = $1
                AND "clientId"       = $2
                AND action           = 'spending_bonus'`,
              [organizationId, order.clientId],
            );

            // how many steps did this order cross?
            const stepsBefore = Math.floor(prevTotalEur / stepEur);
            const stepsAfter = Math.floor((prevTotalEur + thisOrderEur) / stepEur);
            const stepsFromThisOrder = Math.max(0, stepsAfter - stepsBefore);

            // per-order points multiplier from orderMeta (if any)
            let maxMultiplier = 1.0;
            try {
              const { rows: [mrow] } = await pool.query(`SELECT "orderMeta" FROM orders WHERE id = $1`, [order.id]);
              const raw = mrow?.orderMeta;
              const meta = typeof raw === "string"
                ? (raw.trim().startsWith("{") || raw.trim().startsWith("[")) ? JSON.parse(raw) : {}
                : (raw ?? {});
              if (meta && typeof meta === "object" && (meta as any).automation) {
                const m = Number((meta as any).automation.maxPointsMultiplier);
                if (Number.isFinite(m) && m > 1) maxMultiplier = m;
                else if (Array.isArray((meta as any).automation.events)) {
                  for (const e of (meta as any).automation.events) {
                    if (String(e?.event) === "points_multiplier") {
                      const f = Number(e?.factor);
                      if (Number.isFinite(f) && f > maxMultiplier) maxMultiplier = f;
                    }
                  }
                }
              }
              if (Array.isArray(meta)) {
                for (const e of meta) {
                  if (String(e?.event) === "points_multiplier") {
                    const f = Number(e?.factor);
                    if (Number.isFinite(f) && f > maxMultiplier) maxMultiplier = f;
                  }
                }
              }
            } catch { /* ignore */ }

            // baseline catch-up + multiplier extras (only for steps caused by THIS order)
            const shouldHave = stepsAfter * ptsPerStep;
            const baselineDelta = shouldHave - Number(prev.pts);
            const extraFromMult = Math.max(0, (maxMultiplier - 1) * stepsFromThisOrder * ptsPerStep);
            const deltaRaw = Math.max(0, baselineDelta) + extraFromMult;
            const delta = Math.round(deltaRaw * 10) / 10; // nearest 0.1

            if (delta > 0) {
              await pool.query(
                `INSERT INTO "affiliatePointLogs"
        (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,'spending_bonus','Milestone spending bonus',NOW(),NOW())`,
                [uuidv4(), organizationId, order.clientId, delta],
              );
              await pool.query(
                `INSERT INTO "affiliatePointBalances" AS b
        ("clientId","organizationId","pointsCurrent","createdAt","updatedAt")
      VALUES ($1,$2,$3,NOW(),NOW())
      ON CONFLICT("clientId","organizationId") DO UPDATE
        SET "pointsCurrent" = b."pointsCurrent" + EXCLUDED."pointsCurrent",
            "updatedAt"     = NOW()`,
                [order.clientId, organizationId, delta],
              );
            }
          }
        } // end !isWalkInCustomer
      } catch (e) {
        console.warn("[POS checkout][affiliate bonuses] failed", e);
      }

      // ⬇️ POS status notifications (match normal orders)
      try {
        const status = isParked ? "pending_payment" : "paid";
        const notifType = isParked ? "order_pending_payment" : "order_paid";

        const productList = await buildProductListForCart(order.cartId);
        const orderDate = new Date(order.dateCreated).toLocaleDateString("en-GB");
        const vars = {
          product_list: productList,
          order_number: order.orderKey,
          order_date: orderDate,
          order_shipping_method: order.shippingMethod ?? "-",
          tracking_number: order.trackingNumber ?? "",
          shipping_company: order.shippingService ?? "",
        };

        // Buyer fanout (email + in_app + telegram)
        await enqueueNotificationFanout({
          organizationId,
          orderId: order.id,
          type: notifType,
          trigger: "order_status_change",
          channels: ["email", "in_app", "telegram"],
          dedupeSalt: `buyer:${status}`,
          payload: {
            orderId: order.id,
            message: `Your order status is now <b>${status}</b><br>{product_list}`,
            subject: `Order #${order.orderKey} ${status}`,
            variables: vars,
            country: order.country,
            clientId: order.clientId,
            userId: null,
            url: `/orders/${order.id}`,
          },
        });

        // Admin fanout (in_app + telegram)
        await enqueueNotificationFanout({
          organizationId,
          orderId: order.id,
          type: notifType,
          trigger: "admin_only",
          channels: ["in_app", "telegram"],
          dedupeSalt: `store_admin:${status}`,
          payload: {
            orderId: order.id,
            message: `Order #${order.orderKey} is now <b>${status}</b><br>{product_list}`,
            subject: `Order #${order.orderKey} ${status}`,
            variables: vars,
            country: order.country,
            clientId: null,
            userId: null,
            url: `/orders/${order.id}`,
          },
        });

        // If immediately paid, mark single-fire flag so "paid" won’t double notify later
        if (!isParked) {
          await pool.query(
            `UPDATE orders
          SET "notifiedPaidOrCompleted" = TRUE,
              "updatedAt" = NOW()
        WHERE id = $1
          AND COALESCE("notifiedPaidOrCompleted", FALSE) = FALSE`,
            [order.id],
          );
        }

        // Kick the outbox so Telegram/in-app send immediately
        try {
          if (process.env.INTERNAL_API_SECRET) {
            await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/internal/notifications/drain?limit=12`, {
              method: "POST",
              headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET, "x-vercel-background": "1", accept: "application/json" },
              keepalive: true,
            }).catch(() => { });
          } else {
            const { drainNotificationOutbox } = await import("@/lib/notification-outbox");
            await drainNotificationOutbox(12);
          }
        } catch { }
      } catch (e) {
        console.warn("[POS checkout][notify] failed", e);
      }


      return NextResponse.json({ order }, { status: 201 });
    } catch (e) {
      await tx.query("ROLLBACK");
      throw e;
    } finally {
      tx.release();
    }
  } catch (err: any) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
    console.error("[POS POST /pos/checkout] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}