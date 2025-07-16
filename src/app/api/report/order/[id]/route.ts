// src/app/api/order/[id]/report/route.ts   ← full runnable file
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/* ————————— constants ————————— */
const euroCountries = [
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE",
  "IT","LV","LT","LU","MT","NL","PT","SK","SI","ES",
] as const;

const coins: Record<string,string> = {
  BTC:"bitcoin", ETH:"ethereum", USDT:"tether", "USDT.ERC20":"tether", "USDT.TRC20":"tether",
  XRP:"ripple", SOL:"solana", ADA:"cardano", LTC:"litecoin", DOT:"polkadot", BCH:"bitcoin-cash",
  LINK:"chainlink", BNB:"binancecoin", DOGE:"dogecoin", MATIC:"matic-network", XMR:"monero",
};

type CategoryRevenue = {
  categoryId: string; price: number; cost: number; quantity: number;
};
type TransformedCategoryRevenue = {
  categoryId: string; total: number; cost: number;
};

/* ————————— handler ————————— */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id } = await params;

    /* ─── avoid duplicates ───────────────────────────────────────── */
    const { rows: already } = await pool.query(
      `SELECT * FROM "orderRevenue" WHERE "orderId" = $1`,
      [id],
    );
    if (already.length) return NextResponse.json(already[0], { status: 200 });

    /* ─── load order + cart lines ───────────────────────────────── */
    const {
      rows: [order],
    } = await pool.query(
      `SELECT * FROM orders WHERE id = $1 AND "organizationId" = $2 LIMIT 1`,
      [id, organizationId],
    );
    if (!order) throw new Error("Order not found");

    const { cartId, paymentMethod: paymentType, country } = order;
    const from = Math.floor(order.datePaid / 1000);
    const to   = from + 3600;

    const products = (
      await pool.query(
        `SELECT p.*, cp.quantity
           FROM "cartProducts" cp
           JOIN products p ON cp."productId" = p.id
          WHERE cp."cartId" = $1`,
        [cartId],
      )
    ).rows;

    const categoryRows = (
      await pool.query(
        `SELECT cp.*, p.*, pc."categoryId"
           FROM "cartProducts" cp
           JOIN products p        ON cp."productId" = p.id
      LEFT JOIN "productCategory" pc ON pc."productId" = p.id
          WHERE cp."cartId" = $1`,
        [cartId],
      )
    ).rows;

    const categories: CategoryRevenue[] = categoryRows.map((r:any)=>({
      categoryId: r.categoryId,
      price:      r.regularPrice[country],
      cost:       r.cost[country],
      quantity:   r.quantity,
    }));
    const newCategories: TransformedCategoryRevenue[] = categories.map(
      ({categoryId,price,cost,quantity})=>({
        categoryId, total: price*quantity, cost: cost*quantity,
      }),
    );

    const totalCost = products.reduce(
      (sum:any,p:any)=>sum+((p.cost[country]||0)*p.quantity), 0,
    );

    /* ─── crypto branch (niftipay) ─────────────────────────────── */
    let totalUSDfromCrypto = 0;
    if (paymentType === "niftipay") {
      const paid = order.orderMeta?.find((it:any)=>it.event==="paid");
      if (paid) {
        const { asset: coin, amount } = paid.order || {};
        const slug = coins[coin as keyof typeof coins];
        if (slug && amount) {
          const url = `https://api.coingecko.com/api/v3/coins/${slug}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
          const res = await fetch(url,{headers:{accept:"application/json"}});
          if (res.ok) {
            const price = (await res.json()).prices?.[0]?.[1];
            if (price) totalUSDfromCrypto = amount * price;
          }
        }
      }
    }

    /* ─── exchange‑rate row with safe fallback ─────────────────── */
    const { rows: fxRows } = await pool.query(
      `SELECT * FROM "exchangeRate"
        WHERE date BETWEEN to_timestamp($1) AND to_timestamp($2)
        LIMIT 1`,
      [from, to],
    );
    let fx = fxRows[0];

    if (!fx || fx.EUR == null || fx.GBP == null) {
      const { rows: latest } = await pool.query(
        `SELECT * FROM "exchangeRate" ORDER BY date DESC LIMIT 1`,
      );
      fx = latest[0];
    }
    if (!fx || fx.EUR == null || fx.GBP == null) {
      throw new Error("Exchange rates unavailable");
    }

    const USDEUR = Number(fx.EUR);
    const USDGBP = Number(fx.GBP);

    /* ─── shared builder for INSERT *orderRevenue* ─────────────── */
    const revenueId = uuidv4();
    const insertRevenue = async (
      USDtotal:number, USDdiscount:number, USDship:number, USDcost:number,
      GBPtotal:number, GBPdiscount:number, GBPship:number, GBPcost:number,
      EURtotal:number, EURdiscount:number, EURship:number, EURcost:number,
    ) => {
      const q = `
        INSERT INTO "orderRevenue"
          (id,"orderId","USDtotal","USDdiscount","USDshipping","USDcost",
           "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
           "EURtotal","EURdiscount","EURshipping","EURcost",
           "createdAt","updatedAt","organizationId")
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW(),$15)
        RETURNING *`;
      return (
        await pool.query(q, [
          revenueId, id,
          USDtotal.toFixed(2), USDdiscount.toFixed(2), USDship.toFixed(2), USDcost.toFixed(2),
          GBPtotal.toFixed(2), GBPdiscount.toFixed(2), GBPship.toFixed(2), GBPcost.toFixed(2),
          EURtotal.toFixed(2), EURdiscount.toFixed(2), EURship.toFixed(2), EURcost.toFixed(2),
          organizationId,
        ])
      ).rows[0];
    };

    /* ─── currency‑specific math ───────────────────────────────── */
    const mkNums = (
      base:"USD"|"EUR"|"GBP",
      total:number, discount:number, ship:number, cost:number,
    ) => {
      const USD = base==="USD" ? total            : base==="EUR" ? total/USDEUR : total/USDGBP;
      const EUR = base==="EUR" ? total            : base==="USD" ? total*USDEUR : total*(USDEUR/USDGBP);
      const GBP = base==="GBP" ? total            : base==="USD" ? total*USDGBP : total*(USDGBP/USDEUR);

      const conv = (v:number) => ({
        USD: base==="USD"?v           : base==="EUR"?v/USDEUR:v/USDGBP,
        EUR: base==="EUR"?v           : base==="USD"?v*USDEUR:v*(USDEUR/USDGBP),
        GBP: base==="GBP"?v           : base==="USD"?v*USDGBP:v*(USDGBP/USDEUR),
      });

      return {
        USDtotal: USD, USDdiscount: conv(discount).USD, USDship: conv(ship).USD, USDcost: conv(cost).USD,
        GBPtotal: GBP, GBPdiscount: conv(discount).GBP, GBPship: conv(ship).GBP, GBPcost: conv(cost).GBP,
        EURtotal: EUR, EURdiscount: conv(discount).EUR, EURship: conv(ship).EUR, EURcost: conv(cost).EUR,
      };
    };

    const baseTotals = {
      total:        Number(order.totalAmount),
      discount:     Number(order.discountTotal),
      shipping:     Number(order.shippingTotal),
      cost:         totalCost,
    };

    if (paymentType === "niftipay" && totalUSDfromCrypto) {
      baseTotals.total = totalUSDfromCrypto;
    }

    const baseCurr: "USD"|"EUR"|"GBP" =
      country === "GB" ? "GBP" : (euroCountries.includes(country as any) ? "EUR" : "USD");

    const nums = mkNums(
      baseCurr,
      baseTotals.total, baseTotals.discount, baseTotals.shipping, baseTotals.cost,
    );

    const revenue = await insertRevenue(
      nums.USDtotal, nums.USDdiscount, nums.USDship, nums.USDcost,
      nums.GBPtotal, nums.GBPdiscount, nums.GBPship, nums.GBPcost,
      nums.EURtotal, nums.EURdiscount, nums.EURship, nums.EURcost,
    );

    /* ─── per‑category breakdown ─────────────────────────────── */
    const insertCat = `
      INSERT INTO "categoryRevenue"
        (id,"categoryId",
         "USDtotal","USDcost",
         "GBPtotal","GBPcost",
         "EURtotal","EURcost",
         "createdAt","updatedAt","organizationId")
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW(),$9)`;
    for (const ct of newCategories) {
      const conv = mkNums(baseCurr, ct.total, 0, ct.cost, 0);
      await pool.query(insertCat, [
        uuidv4(), ct.categoryId,
        conv.USDtotal.toFixed(2), conv.USDcost.toFixed(2),
        conv.GBPtotal.toFixed(2), conv.GBPcost.toFixed(2),
        conv.EURtotal.toFixed(2), conv.EURcost.toFixed(2),
        organizationId,
      ]);
    }

    return NextResponse.json(revenue, { status: 200 });

  } catch (err:any) {
    console.error("POST /api/order/:id/report", { message: err?.message, stack: err?.stack });
    return NextResponse.json(
      { error: err?.message ?? "Internal server error", stack: err?.stack },
      { status: 500 },
    );
  }
}
