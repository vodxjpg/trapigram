// File: src/app/api/pos/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { enqueueNotificationFanout } from "@/lib/notification-outbox";
import { emitIdleForCart } from "@/lib/customer-display-emit";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";

/* ─────────────────────────────────────────────────────────────
 * Idempotency (prevents duplicate order creation)
 * ──────────────────────────────────────────────────────────── */
async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
  }
  const method = req.method;
  const path = new URL(req.url).pathname;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt")
         VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    const status = r instanceof NextResponse ? r.status : r.status;
    const response = r instanceof NextResponse ? await r.json().catch(() => ({})) : r.body;
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, status, response]
    );
    await c.query("COMMIT");
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/* ─────────────────────────────────────────────────────────────
 * Tier repricing (fast, cached)
 * ──────────────────────────────────────────────────────────── */
const TIER_TTL_MS = 120_000;
const tierCache = new Map<string, { at: number; data: Tier[] }>();
async function getTiersCached(orgId: string): Promise<Tier[]> {
  const now = Date.now();
  const hit = tierCache.get(orgId);
  if (hit && now - hit.at < TIER_TTL_MS) return hit.data;
  const data = (await tierPricing(orgId)) as Tier[];
  tierCache.set(orgId, { at: now, data });
  return data;
}
function targetsList(t: Tier): string[] {
  return ((((t as any).clients as string[] | undefined) ??
          ((t as any).customers as string[] | undefined) ??
          []) as string[]).filter(Boolean);
}

/**
 * Recompute tier prices for a cart, based on current quantities.
 * - dryRun=true  → compute effective subtotal without mutating DB
 * - dryRun=false → UPDATE affected lines to new unitPrice and return new subtotal
 *
 * Targeted tiers (client-scoped) beat global tiers for overlaps.
 */
async function repriceCart(
  cartId: string,
  organizationId: string,
  { dryRun, client }: { dryRun: boolean; client?: any }
): Promise<{ subtotal: number; changedLines: number }> {
  const db = client ?? pool;

  const { rows: cRows } = await db.query(
    `SELECT country, "clientId" FROM carts WHERE id=$1 LIMIT 1`,
    [cartId]
  );
  if (!cRows.length) return { subtotal: 0, changedLines: 0 };
  const country = String(cRows[0].country || "").toUpperCase();
  const clientId = String(cRows[0].clientId || "");

  const tiersAll = await getTiersCached(organizationId);
  const inCountry = (t: Tier) => t.active === true && (t.countries || []).some((c) => String(c || "").toUpperCase() === country);
  const targeted = tiersAll.filter((t) => inCountry(t) && targetsList(t).includes(clientId));
  const global   = tiersAll.filter((t) => inCountry(t) && targetsList(t).length === 0);

  const { rows: raw } = await db.query(
    `SELECT id,"productId","affiliateProductId","variationId",quantity,"unitPrice"
       FROM "cartProducts" WHERE "cartId"=$1`,
    [cartId]
  );
  const lines = raw
    .filter((r: any) => !r.affiliateProductId)
    .map((r: any) => ({
      id: String(r.id),
      productId: String(r.productId),
      variationId: r.variationId ? String(r.variationId) : null,
      quantity: Number(r.quantity || 0),
      unitPrice: Number(r.unitPrice || 0),
    }));

  const indexByProduct = new Map<string, number[]>();
  const indexByVar = new Map<string, number[]>();
  lines.forEach((l, idx) => {
    (indexByProduct.get(l.productId) ?? indexByProduct.set(l.productId, []).get(l.productId)!).push(idx);
    if (l.variationId) {
      (indexByVar.get(l.variationId) ?? indexByVar.set(l.variationId, []).get(l.variationId)!).push(idx);
    }
  });

  const newPriceByLine = new Map<number, number>();
  const lockedProducts = new Set<string>();
  const lockedVars = new Set<string>();

  const applyTier = (t: Tier) => {
    const tierProdIds = (t.products || []).map((p: any) => p.productId).filter(Boolean) as string[];
    const tierVarIds  = (t.products || []).map((p: any) => p.variationId).filter(Boolean) as string[];

    let qty = 0;
    for (const pid of tierProdIds) (indexByProduct.get(pid) || []).forEach((i) => (qty += lines[i].quantity));
    for (const vid of tierVarIds)  (indexByVar.get(vid) || []).forEach((i) => (qty += lines[i].quantity));
    if (qty <= 0) return;

    const tierPrice = getPriceForQuantity((t as any).steps || [], qty);
    if (tierPrice == null) return;

    const willUpdateP: string[] = [];
    const willUpdateV: string[] = [];

    for (const pid of tierProdIds) {
      if (lockedProducts.has(pid)) continue;
      const idxs = indexByProduct.get(pid) || [];
      if (!idxs.length) continue;
      for (const i of idxs) newPriceByLine.set(i, tierPrice);
      willUpdateP.push(pid);
    }
    for (const vid of tierVarIds) {
      if (lockedVars.has(vid)) continue;
      const idxs = indexByVar.get(vid) || [];
      if (!idxs.length) continue;
      for (const i of idxs) newPriceByLine.set(i, tierPrice);
      willUpdateV.push(vid);
    }

    willUpdateP.forEach((p) => lockedProducts.add(p));
    willUpdateV.forEach((v) => lockedVars.add(v));

    return { willUpdateP, willUpdateV, tierPrice };
  };

  let changed = 0;
  const targetedPlan = targeted.map(applyTier).filter(Boolean) as Array<{ willUpdateP: string[]; willUpdateV: string[]; tierPrice: number }>;
  const globalPlan   = global  .map(applyTier).filter(Boolean) as Array<{ willUpdateP: string[]; willUpdateV: string[]; tierPrice: number }>;

  if (!dryRun) {
    for (const step of [...targetedPlan, ...globalPlan]) {
      if (step.willUpdateP.length) {
        const r = await db.query(
          `UPDATE "cartProducts"
              SET "unitPrice"=$1,"updatedAt"=NOW()
            WHERE "cartId"=$2 AND "productId" = ANY($3::text[]) AND "unitPrice" <> $1`,
          [step.tierPrice, cartId, step.willUpdateP],
        );
        changed += Number(r.rowCount || 0);
      }
      if (step.willUpdateV.length) {
        const r = await db.query(
          `UPDATE "cartProducts"
              SET "unitPrice"=$1,"updatedAt"=NOW()
            WHERE "cartId"=$2 AND "variationId" = ANY($3::text[]) AND "unitPrice" <> $1`,
          [step.tierPrice, cartId, step.willUpdateV],
        );
        changed += Number(r.rowCount || 0);
      }
    }
  }

  if (dryRun) {
    let subtotal = 0;
    for (let i = 0; i < lines.length; i++) {
      const price = newPriceByLine.has(i) ? newPriceByLine.get(i)! : lines[i].unitPrice;
      subtotal += price * lines[i].quantity;
    }
    const { rows: aff } = await db.query(
      `SELECT quantity,"unitPrice" FROM "cartProducts" WHERE "cartId"=$1 AND "affiliateProductId" IS NOT NULL`,
      [cartId]
    );
    for (const a of aff) subtotal += Number(a.quantity || 0) * Number(a.unitPrice || 0);
    return { subtotal, changedLines: 0 };
  } else {
    const { rows: sum } = await db.query(
      `SELECT COALESCE(SUM(quantity * "unitPrice"),0)::numeric AS subtotal
         FROM "cartProducts" WHERE "cartId"=$1`,
      [cartId]
    );
    return { subtotal: Number(sum[0]?.subtotal ?? 0), changedLines: changed };
  }
}

/* ─────────────────────────────────────────────────────────────
 * Revenue helpers (unchanged behavior; kept in-file for locality)
 * ──────────────────────────────────────────────────────────── */
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
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES"
];
const currencyFromCountry = (c: string) => (c === "GB" ? "GBP" : euroCountries.includes(c) ? "EUR" : "USD");
const coins: Record<string, string> = {
  BTC:"bitcoin", ETH:"ethereum", USDT:"tether", "USDT.ERC20":"tether", "USDT.TRC20":"tether",
  USDC:"usd-coin","USDC.ERC20":"usd-coin","USDC.TRC20":"usd-coin","USDC.SOL":"usd-coin","USDC.SPL":"usd-coin",
  "USDC.POLYGON":"usd-coin","USDC.BEP20":"usd-coin","USDC.ARBITRUM":"usd-coin","USDC.OPTIMISM":"usd-coin","USDC.BASE":"usd-coin",
  XRP:"ripple", SOL:"solana", ADA:"cardano", LTC:"litecoin", DOT:"polkadot", BCH:"bitcoin-cash",
  LINK:"chainlink", BNB:"binancecoin", DOGE:"dogecoin", MATIC:"matic-network", XMR:"monero",
};

type CategoryRevenue = { categoryId: string | null; price: number; cost: number; quantity: number; };
type TransformedCategoryRevenue = { categoryId: string; total: number; cost: number; };

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
  const { rows: existing } = await pool.query(
    `SELECT * FROM "orderRevenue" WHERE "orderId"=$1 LIMIT 1`, [id]
  );
  if (existing.length) return existing[0];

  const { rows: orderRows } = await pool.query(
    `SELECT * FROM orders WHERE id=$1 AND "organizationId"=$2 LIMIT 1`,
    [id, organizationId]
  );
  const order: any = orderRows[0];
  if (!order) throw new Error("Order not found");

  const cartId: string = order.cartId;
  const country: string = order.country;

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

  const rawPaid = order.datePaid ?? order.dateCreated;
  const paidDate: Date = rawPaid instanceof Date ? rawPaid : new Date(rawPaid);
  if (Number.isNaN(paidDate.getTime())) throw new Error("Invalid paid date");
  const to = Math.floor(paidDate.getTime() / 1000);
  const from = to - 3600;

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
    const catId: string | null = ct.categoryId ? String(ct.categoryId) : null;
    categories.push({ categoryId: catId, price: unitPrice, cost: effCost, quantity: qty });
  }

  const newCategories: TransformedCategoryRevenue[] = categories
    .filter((c) => !!c.categoryId)
    .map(({ categoryId, price, cost, quantity }) => ({
      categoryId: categoryId as string,
      total: price * quantity,
      cost: cost * quantity,
    }));

  const productsCost = categories.reduce((s, c) => s + c.cost * c.quantity, 0);
  const affiliateCost = affRows.reduce((s, a: any) => {
    const unitCost = Number(a?.cost?.[country] ?? 0);
    const qty = Number(a?.quantity ?? 0);
    return s + unitCost * qty;
  }, 0);
  const totalCost = productsCost + affiliateCost;

  let totalUsdFromCrypto = 0;
  let applyCryptoOverride = false;
  let coinRaw = "";
  let amount = 0;
  if (String(order.paymentMethod ?? "").toLowerCase() === "niftipay") {
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

  const { rows: fxRows } = await pool.query(
    `SELECT "EUR","GBP" FROM "exchangeRate" WHERE date <= to_timestamp($1) ORDER BY date DESC LIMIT 1`,
    [to],
  );

  let USDEUR = 0, USDGBP = 0;
  if (!fxRows.length) {
    const apiKey2 = process.env.CURRENCY_LAYER_API_KEY;
    const url = `https://api.currencylayer.com/live?access_key=${apiKey2}&currencies=EUR,GBP`;
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

/* ─────────────────────────────────────────────────────────────
 * Data helpers
 * ──────────────────────────────────────────────────────────── */
async function loadCartSummary(cartId: string, client?: any) {
  const db = client ?? pool;
  const { rows } = await db.query(
    `SELECT ca.id, ca."clientId", ca.country, ca."cartUpdatedHash", ca.status, ca.channel,
            cl."firstName", cl."lastName", cl.username, cl."levelId"
       FROM carts ca
       JOIN clients cl ON cl.id = ca."clientId"
      WHERE ca.id = $1`,
    [cartId]
  );
  if (!rows.length) return null;

  const c = rows[0];

  let normalizedChannel: string =
    (typeof c.channel === "string" ? c.channel : "web") || "web";
  if (normalizedChannel.toLowerCase() === "pos") {
    try {
      await db.query(`UPDATE carts SET channel = $1 WHERE id = $2`, ["pos-", cartId]);
      normalizedChannel = "pos-";
    } catch { /* best effort */ }
  }

  const clientDisplayName =
    [c.firstName, c.lastName].filter(Boolean).join(" ").trim() ||
    c.username ||
    "Customer";

  const { rows: sum } = await db.query<{ subtotal: string }>(
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

async function activePaymentMethods(tenantId: string, client?: any) {
  const db = client ?? pool;
  const { rows } = await db.query(
    `SELECT id, name, active, "default", description, instructions
       FROM "paymentMethods"
      WHERE "tenantId" = $1
        AND active = TRUE
        AND COALESCE("posVisible", TRUE) = TRUE
      ORDER BY "createdAt" DESC`,
    [tenantId]
  );
  return rows;
}

async function buildProductListForCart(cartId: string, client?: any) {
  const db = client ?? pool;
  const { rows } = await db.query(
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
  for (const r of rows) (grouped[r.category] ??= []).push({ q: r.quantity, t: r.title });
  return Object.entries(grouped)
    .map(([cat, items]) => {
      const lines = items.map((it) => `${it.t} - x${it.q}`).join("<br>");
      return `<b>${cat.toUpperCase()}</b><br><br>${lines}`;
    })
    .join("<br><br>");
}

/* ─────────────────────────────────────────────────────────────
 * Schemas & session
 * ──────────────────────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────────────────────
 * GET: summary + ACTIVE methods + effectiveSubtotal (dry-run)
 * ──────────────────────────────────────────────────────────── */
export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

  const url = new URL(req.url);
  const cartId = url.searchParams.get("cartId");
  if (!cartId) return NextResponse.json({ error: "cartId is required" }, { status: 400 });

  const summary = await loadCartSummary(cartId);
  if (!summary) return NextResponse.json({ error: "Cart not found" }, { status: 404 });
  if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
    return NextResponse.json({ error: "Not a POS cart" }, { status: 400 });
  }

  const { subtotal: effectiveSubtotal } = await repriceCart(cartId, organizationId, { dryRun: true });
  const methods = await activePaymentMethods(tenantId);
  return NextResponse.json({ summary, paymentMethods: methods, effectiveSubtotal }, { status: 200 });
}

/* ─────────────────────────────────────────────────────────────
 * POST: create order (Shopify-fast, single TX, idempotent)
 * ──────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  const { tenantId, organizationId } = ctx as { tenantId: string | null; organizationId: string };
  const T0 = Date.now();
  const marks: Array<[string, number]> = [];
  const mark = (label: string) => marks.push([label, Date.now() - T0]);

  return withIdempotency(req, async () => {
    try {
      const rawBody = await req.json();
      const { cartId, payments, storeId, registerId, discount, parked } =
        CheckoutCreateSchema.parse(rawBody);
      const isParked = Boolean(parked);
      if (!tenantId) return NextResponse.json({ error: "Tenant not found" }, { status: 404 });

      const methods = await activePaymentMethods(tenantId);
      if (!methods.length) return NextResponse.json({ error: "No active payment methods configured" }, { status: 400 });
      const activeIds = new Set(methods.map((m: any) => m.id));
      for (const p of payments) {
        if (!activeIds.has(p.methodId)) {
          return NextResponse.json({ error: `Inactive/invalid payment method: ${p.methodId}` }, { status: 400 });
        }
      }
      mark("validated_methods");

      let discountKind: "fixed" | "percentage" | null = null;
      let discountValue = 0;
      if (discount && Number.isFinite(discount.value) && discount.value > 0) {
        discountKind = discount.type;
        discountValue = discount.value;
        await pool.query(`UPDATE carts SET "couponCode" = $1, "updatedAt" = NOW() WHERE id = $2`, ["POS", cartId]);
      }
      mark("discount_marker");

      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        mark("tx_begin");

        const summary = await loadCartSummary(cartId, tx);
        if (!summary) { await tx.query("ROLLBACK"); return NextResponse.json({ error: "Cart not found" }, { status: 404 }); }
        if (!summary.status) { await tx.query("ROLLBACK"); return NextResponse.json({ error: "Cart is not active" }, { status: 400 }); }
        if (typeof summary.channel !== "string" || !summary.channel.toLowerCase().startsWith("pos-")) {
          await tx.query("ROLLBACK");
          return NextResponse.json({ error: "Only POS carts can be checked out here" }, { status: 400 });
        }
        mark("summary_loaded");

        // Apply tier prices and compute fresh subtotal inside TX
        const { subtotal: pricedSubtotal } = await repriceCart(cartId, organizationId, { dryRun: false, client: tx });
        mark("repriced");

        // Recompute cart hash
        const { rows: hv } = await tx.query(
          `SELECT COUNT(*)::int AS n,
                  COALESCE(SUM(quantity),0)::int AS q,
                  COALESCE(SUM((quantity * "unitPrice")::numeric),0)::text AS v
             FROM "cartProducts" WHERE "cartId"=$1`,
          [cartId]
        );
        const cartHash = crypto.createHash("sha256").update(`${hv[0].n}|${hv[0].q}|${hv[0].v}`).digest("hex");
        await tx.query(`UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`, [cartHash, cartId]);
        mark("cart_hash");

        // Totals
        const shippingTotal = 0;
        const subtotal = Number(pricedSubtotal || 0);

        let discountTotal = 0;
        let couponType: "fixed" | "percentage" | null = null;
        let discountValueArr: string[] = [];
        if (discountKind && discountValue > 0) {
          if (discountKind === "percentage") {
            const pct = Math.max(0, Math.min(100, discountValue));
            discountTotal = +(subtotal * (pct / 100)).toFixed(2);
            couponType = "percentage";
            discountValueArr = [String(pct)];
          } else {
            const fixed = Math.max(0, discountValue);
            discountTotal = +Math.min(subtotal, fixed).toFixed(2);
            couponType = "fixed";
            discountValueArr = [String(fixed)];
          }
        }
        const totalAmount = +(subtotal + shippingTotal - discountTotal).toFixed(2);
        const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0);
        const epsilon = 0.01;
        if (Math.abs(paid - totalAmount) > epsilon) {
          await tx.query("ROLLBACK");
          return NextResponse.json(
            { error: `Total changed after quantity discounts were applied. New total is ${totalAmount.toFixed(2)}.` },
            { status: 409 }
          );
        }
        mark("totals");

        // Generate order id and key
        const orderId = uuidv4();
        await tx.query(`CREATE SEQUENCE IF NOT EXISTS order_key_seq START 1 INCREMENT 1 OWNED BY NONE`);
        const { rows: seqRows } = await tx.query(`SELECT nextval('order_key_seq') AS seq`);
        const seqNum = String(Number(seqRows[0].seq)).padStart(4, "0");
        const orderKey = `POS-${seqNum}`;

        // Primary payment name (or 'split')
        const primaryMethodName =
          payments.length === 0
            ? null
            : (payments.length > 1
                ? "split"
                : (methods.find((m: any) => String(m.id) === String(payments[0].methodId))?.name ?? null));

        // Channel stamp (pos-<store>-<register>)
        let orderChannel = summary.channel;
        if (orderChannel === "pos-" && (storeId || registerId)) {
          orderChannel = `pos-${storeId ?? "na"}-${registerId ?? "na"}`;
          await tx.query(`UPDATE carts SET channel=$1 WHERE id=$2`, [orderChannel, cartId]);
        }

        // Build initial meta (cashier + parked)
        const currentUser = await fetchCurrentUserFromSession(req);
        const metaArr: any[] = [{
          event: "cashier",
          type: "pos_checkout",
          cashierId: currentUser?.id ?? (ctx as any).userId ?? null,
          cashierName: currentUser?.name ?? null,
          storeId: storeId ?? null,
          registerId: registerId ?? null,
          at: new Date().toISOString(),
        }];
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
          orderStatus,
          primaryMethodName,
          orderKey,
          cartHash,
          shippingTotal,
          discountTotal,
          totalAmount,
          discountKind ? "POS" : null,
          couponType,
          discountValueArr,
          "-",
          new Date(),
          datePaid,
          dateCompleted,
          null,
          initialOrderMeta,
          organizationId,
          orderChannel,
        ];

        const { rows: orderRows } = await tx.query(insertSql, vals);
        const order = orderRows[0];
        mark("order_inserted");

        // Persist splits
        for (const p of payments) {
          await tx.query(
            `INSERT INTO "orderPayments"(id,"orderId","methodId",amount)
             VALUES ($1,$2,$3,$4)`,
            [uuidv4(), order.id, p.methodId, Number(p.amount)]
          );
        }
        mark("splits");

        // Close cart
        await tx.query(`UPDATE carts SET status = FALSE, "updatedAt" = NOW() WHERE id = $1`, [cartId]);
        mark("cart_closed");

        await tx.query("COMMIT");
        mark("tx_commit");

        // ── Non-blocking post-commit side-effects ─────────────────
        // 1) Clear customer display
        (async () => { try { await emitIdleForCart(cartId); } catch {} })();

        // 2) Revenue
        (async () => { try { await getRevenue(order.id, organizationId); } catch (e) { console.warn("[POS checkout][revenue] failed", e); } })();

        // 3) Platform fee
        (async () => {
          try {
            const feesUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/internal/order-fees`;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (process.env.INTERNAL_API_SECRET) headers["x-internal-secret"] = process.env.INTERNAL_API_SECRET;
            else headers["x-local-invoke"] = "1";
            const res = await fetch(feesUrl, {
              method: "POST",
              headers,
              body: JSON.stringify({ orderId: order.id }),
            });
            if (!res.ok) console.error(`[fees][pos] ${res.status} ${res.statusText}`, await res.text().catch(() => ""));
          } catch (e) {
            console.warn("[POS checkout][fees] failed", e);
          }
        })();

        // 4) Affiliate bonuses
        (async () => {
          try {
            const { rows: [who] } = await pool.query(
              `SELECT LOWER(COALESCE("firstName", '')) AS "firstName",
                      LOWER(COALESCE(username, ''))    AS "username"
                 FROM clients
                WHERE id = $1
                LIMIT 1`,
              [order.clientId],
            );
            const isWalkInCustomer =
              (who?.firstName === "walk-in") ||
              (typeof who?.username === "string" && who.username.startsWith("walkin-"));
            if (!isWalkInCustomer) {
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

              // one-time referral award
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

              // spending milestone bonus
              if (stepEur > 0 && ptsPerStep > 0) {
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
                const { rows: [fx] } = await pool.query(
                  `SELECT "EUR","GBP" FROM "exchangeRate" ORDER BY date DESC LIMIT 1`
                );
                let USDEUR = Number(fx?.EUR ?? 1);
                let USDGBP = Number(fx?.GBP ?? 1);
                if (!(USDEUR > 0)) USDEUR = 1; if (!(USDGBP > 0)) USDGBP = 1;

                const amt = Number(order.totalAmount ?? 0);
                const ctry = String(order.country ?? "");
                const thisOrderEur = euroCountries.includes(ctry)
                  ? amt
                  : (ctry === "GB" ? amt * (USDEUR / USDGBP) : amt * USDEUR);

                const { rows: [prev] } = await pool.query(
                  `SELECT COALESCE(SUM(points),0) AS pts
                     FROM "affiliatePointLogs"
                    WHERE "organizationId" = $1
                      AND "clientId"       = $2
                      AND action           = 'spending_bonus'`,
                  [organizationId, order.clientId],
                );

                const stepsBefore = Math.floor(prevTotalEur / stepEur);
                const stepsAfter = Math.floor((prevTotalEur + thisOrderEur) / stepEur);
                const stepsFromThisOrder = Math.max(0, stepsAfter - stepsBefore);

                let maxMultiplier = 1.0;
                try {
                  const raw = order.orderMeta;
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

                const shouldHave = stepsAfter * ptsPerStep;
                const baselineDelta = shouldHave - Number(prev.pts);
                const extraFromMult = Math.max(0, (maxMultiplier - 1) * stepsFromThisOrder * ptsPerStep);
                const deltaRaw = Math.max(0, baselineDelta) + extraFromMult;
                const delta = Math.round(deltaRaw * 10) / 10;

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
            }
          } catch (e) {
            console.warn("[POS checkout][affiliate bonuses] failed", e);
          }
        })();

        // 5) Niftipay Invoice (if chosen & chain/asset present)
        (async () => {
          try {
            const niftiReq = (rawBody?.niftipay ?? undefined) as { chain?: string; asset?: string; amount?: number } | undefined;
            const methodIds = Array.from(new Set((rawBody?.payments ?? payments ?? []).map((p: any) => String(p.methodId))));
            let niftiAmount = 0;
            if (methodIds.length) {
              const { rows: pmRows } = await pool.query(
                `SELECT id, name FROM "paymentMethods" WHERE id::text = ANY($1::text[])`,
                [methodIds]
              );
              const niftiIds = new Set(pmRows.filter((r) => (r.name || "").toLowerCase() === "niftipay").map((r) => String(r.id)));
              niftiAmount = ((rawBody?.payments ?? payments ?? []) as any[])
                .filter((p: any) => niftiIds.has(String(p.methodId)))
                .reduce((s: number, p: any) => s + Number(p.amount || 0), 0);
            }
            if (niftiAmount > 0 && niftiReq?.chain && niftiReq?.asset) {
              const { rows: clientRows } = await pool.query(
                `SELECT "firstName","lastName",email FROM clients WHERE id=$1 LIMIT 1`,
                [order.clientId]
              );
              const c = clientRows[0] || {};
              const currency = currencyFromCountry(String(order.country));
              const origin = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin;
              const { res: nifRes, data: nifData } = await fetchJSON(
                `${origin}/api/niftipay/orders`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  timeoutMs: 8000,
                  body: JSON.stringify({
                    network: niftiReq.chain,
                    asset: niftiReq.asset,
                    amount: Number.isFinite(niftiReq.amount) && niftiReq.amount! > 0 ? niftiReq.amount : niftiAmount,
                    currency,
                    firstName: c.firstName ?? null,
                    lastName: c.lastName ?? null,
                    email: c.email ?? "user@trapyfy.com",
                    merchantId: organizationId,
                    reference: orderKey,
                  }),
                }
              );
              if (nifRes.ok && nifData) {
                await pool.query(
                  `UPDATE orders
                     SET "orderMeta" = COALESCE("orderMeta",'[]'::jsonb) || $1::jsonb,
                         "updatedAt" = NOW()
                   WHERE id = $2`,
                  [JSON.stringify([nifData]), order.id]
                );
              }
            }
          } catch (e) {
            console.warn("[POS checkout][niftipay] invoice creation failed", e);
          }
        })();

        // 6) Notifications (buyer+admin) + outbox drain
        (async () => {
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

            try {
              if (process.env.INTERNAL_API_SECRET) {
                await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/internal/notifications/drain?limit=12`, {
                  method: "POST",
                  headers: { "x-internal-secret": process.env.INTERNAL_API_SECRET, "x-vercel-background": "1", accept: "application/json" },
                  keepalive: true,
                }).catch(() => { /* ignore */ });
              } else {
                const { drainNotificationOutbox } = await import("@/lib/notification-outbox");
                await drainNotificationOutbox(12);
              }
            } catch { /* ignore */ }
          } catch (e) {
            console.warn("[POS checkout][notify] failed", e);
          }
        })();

        const res = NextResponse.json({ order }, { status: 201 });
        const serverTiming = marks.map(([l, d], i) => `m${i};desc="${l}";dur=${d}`).join(", ");
        res.headers.set("Server-Timing", serverTiming);
        res.headers.set("X-Route-Duration", `${Date.now() - T0}ms`);
        return res;
      } catch (e) {
        try { await (pool as any).query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        // always release
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        (await (async () => {/* no-op */})());
        // release handled by tx.release below in original code pattern; here we guarantee client release:
        // but we kept tx in scope, so:
        // @ts-ignore
        if (typeof (tx?.release) === "function") tx.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
      console.error("[POS POST /pos/checkout] error:", err);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  });
}
