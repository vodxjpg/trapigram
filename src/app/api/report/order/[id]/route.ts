// src/app/api/report/order/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool, pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/* ────────────────────────────────────────────────────────────────
   Dropshipper helpers (mirror logic from /api/order/[id])
──────────────────────────────────────────────────────────────── */
function asArray(meta: unknown): any[] {
  if (!meta) return [];
  if (Array.isArray(meta)) return meta;
  if (typeof meta === "string") {
    try {
      const p = JSON.parse(meta);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}
function extractDropshipper(meta: unknown): { orgId: string | null; name: string | null } {
  const arr = asArray(meta);
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    if (m && m.type === "dropshipper" && typeof m.organizationId === "string") {
      return { orgId: m.organizationId, name: typeof m.name === "string" ? m.name : null };
    }
  }
  return { orgId: null, name: null };
}
async function resolveDropshipperLabel(orgId: string | null): Promise<string | null> {
  if (!orgId) return null;
  const orgQ = await pool.query(
    `SELECT name, metadata FROM "organization" WHERE id = $1 LIMIT 1`,
    [orgId],
  );
  if (!orgQ.rowCount) return null;
  const orgName: string = orgQ.rows[0].name ?? "";
  let email: string | null = null;
  const rawMeta: string | null = orgQ.rows[0].metadata ?? null;
  if (rawMeta) {
    try {
      const meta = JSON.parse(rawMeta);
      const tenantId = typeof meta?.tenantId === "string" ? meta.tenantId : null;
      if (tenantId) {
        const tQ = await pool.query(
          `SELECT "ownerEmail" FROM "tenant" WHERE id = $1 LIMIT 1`,
          [tenantId],
        );
        email = (tQ.rows[0]?.ownerEmail as string) ?? null;
      }
    } catch {
      /* ignore malformed */
    }
  }
  return email ? `${orgName} (${email})` : orgName;
}

/* ────────────────────────────────────────────────────────────────
   FX & crypto config
──────────────────────────────────────────────────────────────── */
const apiKey = process.env.CURRENCY_LAYER_API_KEY;
const dbg = (...a: any[]) => console.log("[orderRevenue]", ...a);
if (!process.env.CURRENCY_LAYER_API_KEY)
  console.warn("[orderRevenue] ⚠️  CURRENCY_LAYER_API_KEY is not set");

const euroCountries = [
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"
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

/* ────────────────────────────────────────────────────────────────
   Small JSON helpers
──────────────────────────────────────────────────────────────── */
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

/* ────────────────────────────────────────────────────────────────
   Effective cost resolver (handles shared products)
──────────────────────────────────────────────────────────────── */
const mappingCache = new Map<string, { shareLinkId: string; sourceProductId: string } | null>();
const costCache = new Map<string, number>();

async function resolveEffectiveCost(productId: string, country: string): Promise<number> {
  const key = `${productId}:${country}`;
  if (costCache.has(key)) return costCache.get(key)!;

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
    const { rows } = await pool.query(
      `SELECT cost
         FROM "sharedProduct"
        WHERE "shareLinkId" = $1 AND "productId" = $2
        LIMIT 1`,
      [mapping.shareLinkId, mapping.sourceProductId],
    );
    eff = priceByCountry(rows[0]?.cost ?? null, country);
  } else {
    const { rows } = await pool.query(`SELECT cost FROM products WHERE id = $1 LIMIT 1`, [productId]);
    eff = priceByCountry(rows[0]?.cost ?? null, country);
  }

  costCache.set(key, eff);
  return eff;
}

/* ────────────────────────────────────────────────────────────────
   Types for category rollup
──────────────────────────────────────────────────────────────── */
type CategoryRevenue = { categoryId: string; price: number; cost: number; quantity: number };
type TransformedCategoryRevenue = { categoryId: string; total: number; cost: number };

/* ────────────────────────────────────────────────────────────────
   Route
──────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;
    console.log("[orderRevenue] ⇢ start", { id, organizationId });

    /* 0) if revenue already exists, return it (enriched) */
    {
      const { rows } = await pool.query(
        `SELECT * FROM "orderRevenue" WHERE "orderId" = $1 LIMIT 1`,
        [id],
      );
      if (rows.length > 0) {
        const ordQ = await pool.query(`SELECT "orderMeta" FROM orders WHERE id = $1 LIMIT 1`, [id]);
        const drops = extractDropshipper(ordQ.rows[0]?.orderMeta);
        const label = drops.name ?? (await resolveDropshipperLabel(drops.orgId));
        return NextResponse.json(
          { ...rows[0], dropshipperOrgId: drops.orgId ?? null, dropshipperLabel: label ?? null },
          { status: 200 },
        );
      }
    }

    /* 1) load order (and gate on status) */
    const ordRes = await pool.query(
      `SELECT *
         FROM orders
        WHERE id = $1 AND "organizationId" = $2
        LIMIT 1`,
      [id, organizationId],
    );
    const order = ordRes.rows[0];
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const paidLike = new Set(["paid", "completed", "pending_payment"]);
    const status = String(order.status || "").toLowerCase();
    if (!paidLike.has(status)) {
      return NextResponse.json(
        { error: "Revenue can only be generated for paid orders" },
        { status: 409 },
      );
    }

    const cartId: string = order.cartId;
    const paymentType: string = String(order.paymentMethod ?? "").toLowerCase();
    const country: string = order.country;

    /* robust paid date: fall back to dateCreated if needed (e.g., pending_payment) */
    const rawDate = order.datePaid ?? order.dateCreated;
    const paidDate = rawDate instanceof Date ? rawDate : new Date(rawDate);
    if (Number.isNaN(paidDate.getTime())) {
      return NextResponse.json({ error: "Invalid paid date" }, { status: 400 });
    }
    // window for external pricing (past hour → at paidDate)
    const to = Math.floor(paidDate.getTime() / 1000);
    const from = to - 3600;

    /* 2) load products (normal + affiliate) */
    const productsRes = await pool.query(
      `SELECT p.*, cp.quantity, cp."unitPrice"
         FROM "cartProducts" cp
         JOIN products p ON cp."productId" = p.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const products = productsRes.rows;

    const affiliateRes = await pool.query(
      `SELECT ap.*, cp.quantity
         FROM "cartProducts" cp
         JOIN "affiliateProducts" ap ON cp."affiliateProductId" = ap.id
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const affiliate = affiliateRes.rows;

    /* 3) build categories from normal products only */
    const categoryRes = await pool.query(
      `SELECT cp.*, p.*, pc."categoryId"
         FROM "cartProducts" AS cp
         JOIN "products" AS p  ON cp."productId" = p."id"
    LEFT JOIN "productCategory" AS pc ON pc."productId" = p."id"
        WHERE cp."cartId" = $1`,
      [cartId],
    );
    const categoryRows = categoryRes.rows;

    const categories: CategoryRevenue[] = [];
    for (const ct of categoryRows) {
      const qty = Number(ct.quantity ?? 0);
      // prefer actual unit price charged, else fallback to product price map
      const price =
        Number(ct.unitPrice ?? NaN) ||
        priceByCountry(ct.regularPrice ?? ct.price ?? null, country) ||
        0;
      const effCost = await resolveEffectiveCost(String(ct.productId), country);
      categories.push({
        categoryId: ct.categoryId,
        price,
        cost: effCost,
        quantity: qty,
      });
    }

    const newCategories: TransformedCategoryRevenue[] = categories.map(({ categoryId, price, cost, quantity }) => ({
      categoryId,
      total: price * quantity,
      cost: cost * quantity,
    }));

    // total cost: effective cost on normal products + affiliate native cost
    const productsCost = categories.reduce((s, c) => s + c.cost * c.quantity, 0);
    const affiliateCost = affiliate.reduce((s: number, a: any) => {
      const unitCost = priceByCountry(a?.cost ?? null, country);
      const qty = Number(a?.quantity ?? 0);
      return s + unitCost * qty;
    }, 0);
    const totalCost = productsCost + affiliateCost;

    /* 4) crypto override (Niftipay/Coinslick) – use latest price point in window */
    let totalOverrideUSD = 0;
    let useCryptoOverride = false;
    if (paymentType === "niftipay") {
      const metaArr = asArray(order.orderMeta);
      const paidEntry = metaArr.find((m) => String(m?.event ?? "").toLowerCase() === "paid");
      const coinRaw = String(paidEntry?.order?.asset ?? "");
      const amount = Number(paidEntry?.order?.amount ?? 0);
      if (coinRaw && amount > 0) {
        const coinKey = coinRaw.toUpperCase();
        const coinId = coins[coinKey];
        if (!coinId) {
          return NextResponse.json({ error: `Unsupported crypto asset "${coinKey}"` }, { status: 400 });
        }
        const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        dbg("CoinGecko →", url);
        const res = await fetch(url, { method: "GET", headers: { accept: "application/json" } });
        dbg("CoinGecko ←", res.status, res.statusText);
        if (!res.ok) {
          return NextResponse.json({ error: `CoinGecko HTTP ${res.status}` }, { status: 502 });
        }
        const data = await res.json();
        const prices: any[] = Array.isArray(data?.prices) ? data.prices : [];
        const last = prices.length ? prices[prices.length - 1][1] : null;
        if (last == null) {
          return NextResponse.json({ error: "No price data from CoinGecko" }, { status: 502 });
        }
        totalOverrideUSD = amount * Number(last);
        useCryptoOverride = true;
      }
    }

    /* 5) FX: nearest at/before paid time; else fetch live & cache */
    let USDEUR = 0;
    let USDGBP = 0;
    {
      const ex = await pgPool.query(
        `SELECT "EUR","GBP"
           FROM "exchangeRate"
          WHERE date <= to_timestamp($1)
          ORDER BY date DESC
          LIMIT 1`,
        [to],
      );
      if (ex.rows.length) {
        USDEUR = Number(ex.rows[0].EUR) || 0;
        USDGBP = Number(ex.rows[0].GBP) || 0;
      } else {
        if (!apiKey) {
          return NextResponse.json({ error: "Missing FX rates and CURRENCY_LAYER_API_KEY" }, { status: 502 });
        }
        const url = `https://api.currencylayer.com/live?access_key=${apiKey}&currencies=EUR,GBP`;
        dbg("CurrencyLayer →", url);
        const res = await fetch(url);
        dbg("CurrencyLayer ←", res.status, res.statusText);
        if (!res.ok) return NextResponse.json({ error: "FX provider error" }, { status: 502 });
        const data = await res.json();
        const usdEur = Number(data?.quotes?.USDEUR);
        const usdGbp = Number(data?.quotes?.USDGBP);
        if (!usdEur || !usdGbp) {
          return NextResponse.json({ error: "Invalid FX response" }, { status: 502 });
        }
        const ins = await pgPool.query(
          `INSERT INTO "exchangeRate" ("EUR","GBP", date)
           VALUES ($1,$2,$3)
           RETURNING "EUR","GBP"`,
          [usdEur, usdGbp, paidDate],
        );
        USDEUR = Number(ins.rows[0].EUR);
        USDGBP = Number(ins.rows[0].GBP);
      }
    }

    /* 6) currency math by native currency */
    const revenueId = uuidv4();

    // read monetary fields from order
    let totalNative = Number(order.totalAmount) || 0;
    const discountNative = Number(order.discountTotal) || 0;
    const shippingNative = Number(order.shippingTotal) || 0;

    // override totals for crypto orders (in USD then convert)
    let USDtotal = 0, USDdiscount = 0, USDshipping = 0, USDcost = 0;
    let GBPtotal = 0, GBPdiscount = 0, GBPshipping = 0, GBPcost = 0;
    let EURtotal = 0, EURdiscount = 0, EURshipping = 0, EURcost = 0;

    const isGB = country === "GB";
    const isEUR = euroCountries.includes(country);

    if (isGB) {
      // native = GBP
      let totalGBP = totalNative;
      if (useCryptoOverride) totalGBP = totalOverrideUSD * USDGBP;

      GBPtotal = totalGBP;
      GBPdiscount = discountNative;
      GBPshipping = shippingNative;
      GBPcost = totalCost;

      USDtotal = totalGBP / USDGBP;
      USDdiscount = GBPdiscount / USDGBP;
      USDshipping = GBPshipping / USDGBP;
      USDcost = GBPcost / USDGBP;

      EURtotal = totalGBP * (USDEUR / USDGBP);
      EURdiscount = GBPdiscount * (USDEUR / USDGBP);
      EURshipping = GBPshipping * (USDEUR / USDGBP);
      EURcost = GBPcost * (USDEUR / USDGBP);
    } else if (isEUR) {
      // native = EUR
      let totalEUR_ = totalNative;
      if (useCryptoOverride) totalEUR_ = totalOverrideUSD * USDEUR;

      EURtotal = totalEUR_;
      EURdiscount = discountNative;
      EURshipping = shippingNative;
      EURcost = totalCost;

      USDtotal = EURtotal / USDEUR;
      USDdiscount = EURdiscount / USDEUR;
      USDshipping = EURshipping / USDEUR;
      USDcost = EURcost / USDEUR;

      GBPtotal = EURtotal * (USDGBP / USDEUR);
      GBPdiscount = EURdiscount * (USDGBP / USDEUR);
      GBPshipping = EURshipping * (USDGBP / USDEUR);
      GBPcost = EURcost * (USDGBP / USDEUR);
    } else {
      // native = USD
      let totalUSD_ = totalNative;
      if (useCryptoOverride) totalUSD_ = totalOverrideUSD;

      USDtotal = totalUSD_;
      USDdiscount = discountNative;
      USDshipping = shippingNative;
      USDcost = totalCost;

      GBPtotal = USDtotal * USDGBP;
      GBPdiscount = USDdiscount * USDGBP;
      GBPshipping = USDshipping * USDGBP;
      GBPcost = USDcost * USDGBP;

      EURtotal = USDtotal * USDEUR;
      EURdiscount = USDdiscount * USDEUR;
      EURshipping = USDshipping * USDEUR;
      EURcost = USDcost * USDEUR;
    }

    /* 7) insert orderRevenue */
    const insertRev = await pool.query(
      `INSERT INTO "orderRevenue" (
         id, "orderId",
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
       RETURNING *`,
      [
        revenueId, id,
        USDtotal, USDdiscount, USDshipping, USDcost,
        GBPtotal, GBPdiscount, GBPshipping, GBPcost,
        EURtotal, EURdiscount, EURshipping, EURcost,
        organizationId,
      ],
    );
    const revenueRow = insertRev.rows[0];

    /* 8) insert categoryRevenue for product categories */
    for (const ct of newCategories) {
      const catId = uuidv4();

      let USDt = 0, USDc = 0, GBPt = 0, GBPc = 0, EURt = 0, EURc = 0;

      if (isGB) {
        // native = GBP
        GBPt = ct.total; GBPc = ct.cost;
        USDt = ct.total / USDGBP; USDc = ct.cost / USDGBP;
        EURt = ct.total * (USDEUR / USDGBP); EURc = ct.cost * (USDEUR / USDGBP);
      } else if (isEUR) {
        // native = EUR
        EURt = ct.total; EURc = ct.cost;
        USDt = ct.total / USDEUR; USDc = ct.cost / USDEUR;
        GBPt = ct.total * (USDGBP / USDEUR); GBPc = ct.cost * (USDGBP / USDEUR);
      } else {
        // native = USD
        USDt = ct.total; USDc = ct.cost;
        GBPt = ct.total * USDGBP; GBPc = ct.cost * USDGBP;
        EURt = ct.total * USDEUR; EURc = ct.cost * USDEUR;
      }

      await pool.query(
        `INSERT INTO "categoryRevenue" (
           id,"categoryId",
           "USDtotal","USDcost",
           "GBPtotal","GBPcost",
           "EURtotal","EURcost",
           "createdAt","updatedAt","organizationId"
         ) VALUES (
           $1,$2,
           $3,$4,
           $5,$6,
           $7,$8,
           NOW(),NOW(),$9
         )`,
        [catId, ct.categoryId, USDt, USDc, GBPt, GBPc, EURt, EURc, organizationId],
      );
    }

    /* 9) enrich with dropshipper info for the response */
    const ordQ = await pool.query(`SELECT "orderMeta" FROM orders WHERE id = $1 LIMIT 1`, [id]);
    const drops = extractDropshipper(ordQ.rows[0]?.orderMeta);
    const label = drops.name ?? (await resolveDropshipperLabel(drops.orgId));

    return NextResponse.json(
      { ...revenueRow, dropshipperOrgId: drops.orgId ?? null, dropshipperLabel: label ?? null },
      { status: 200 },
    );
  } catch (error) {
    console.error("[orderRevenue] ERROR", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
