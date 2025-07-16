// src/app/api/order/[id]/report/route.ts    ← replace entire file
import { NextRequest, NextResponse } from "next/server";
import { pgPool, pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

/* ————————— constants ————————— */
const euroCountries = [
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES",
];

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

    /* ————— guard: duplicate ————— */
    const checkQuery = `SELECT * FROM "orderRevenue" WHERE "orderId" = '${id}'`;
    const checkRows  = (await pool.query(checkQuery)).rows;
    if (checkRows.length) {
      return NextResponse.json(checkRows[0], { status: 200 });
    }

    /* ————— fetch order basics ————— */
    const orderQuery   = `SELECT * FROM orders WHERE id = '${id}' AND "organizationId" = '${organizationId}'`;
    const order        = (await pool.query(orderQuery)).rows[0];
    const { cartId, paymentMethod: paymentType, country } = order;

    const date   = order.datePaid;
    const from   = Math.floor(date / 1000);
    const to     = from + 3600;

    /* ————— cart lines ————— */
    const productQuery = `
      SELECT p.*, cp.quantity
        FROM "cartProducts" cp
        JOIN products p ON cp."productId" = p.id
       WHERE cp."cartId" = '${cartId}'`;
    const products = (await pool.query(productQuery)).rows;

    /* ————— categories ————— */
    const categoryQuery = `
      SELECT cp.*, p.*, pc."categoryId"
        FROM "cartProducts"  cp
        JOIN products        p  ON cp."productId" = p.id
   LEFT JOIN "productCategory" pc ON pc."productId" = p.id
       WHERE cp."cartId" = '${cartId}'`;
    const categoryRows = (await pool.query(categoryQuery)).rows;

    const categories: CategoryRevenue[] = categoryRows.map((ct:any) => ({
      categoryId: ct.categoryId,
      price:      ct.regularPrice[country],
      cost:       ct.cost[country],
      quantity:   ct.quantity,
    }));
    const newCategories: TransformedCategoryRevenue[] = categories.map(
      ({ categoryId, price, cost, quantity }) => ({
        categoryId,
        total: price * quantity,
        cost:  cost  * quantity,
      }),
    );

    /* ————— cost total ————— */
    const totalCost = products.reduce(
      (sum:any,p:any)=>sum+((p.cost[country]*p.quantity)||0),0,
    );

    /* ————— crypto branch ————— */
    let total = 0;
    if (paymentType === "niftipay") {
      const paid = order.orderMeta.find((it:any)=>it.event==="paid");
      if (paid) {
        const { asset: coin, amount } = paid.order;
        const url = `https://api.coingecko.com/api/v3/coins/${coins[coin]}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const res = await fetch(url,{headers:{accept:"application/json"}});
        if (!res.ok) throw new Error(`Coingecko ${res.status} ${res.statusText}`);
        const price = (await res.json()).prices?.[0]?.[1] ?? 0;
        total = amount * price;
      }
    }

    /* ————— fx rates ————— */
    const fxRow = (await pgPool.query(
      `SELECT * FROM "exchangeRate"
        WHERE date BETWEEN to_timestamp(${from}) AND to_timestamp(${to})`,
    )).rows[0];
    const USDEUR = fxRow.EUR;
    const USDGBP = fxRow.GBP;

    /* ————— revenue calculation ————— */
    const revenueId = uuidv4();
    const buildInsert = (
      USDtotal:number, USDdiscount:number, USDship:number, USDcost:number,
      GBPtotal:number, GBPdiscount:number, GBPship:number, GBPcost:number,
      EURtotal:number, EURdiscount:number, EURship:number, EURcost:number,
    ) => `
      INSERT INTO "orderRevenue"
        (id,"orderId","USDtotal","USDdiscount","USDshipping","USDcost",
         "GBPtotal","GBPdiscount","GBPshipping","GBPcost",
         "EURtotal","EURdiscount","EURshipping","EURcost",
         "createdAt","updatedAt","organizationId")
      VALUES
        ('${revenueId}','${id}',
         ${USDtotal.toFixed(2)},${USDdiscount.toFixed(2)},${USDship.toFixed(2)},${USDcost.toFixed(2)},
         ${GBPtotal.toFixed(2)},${GBPdiscount.toFixed(2)},${GBPship.toFixed(2)},${GBPcost.toFixed(2)},
         ${EURtotal.toFixed(2)},${EURdiscount.toFixed(2)},${EURship.toFixed(2)},${EURcost.toFixed(2)},
         NOW(),NOW(),'${organizationId}')
      RETURNING *`;

    /* ————— currency‑specific branches ————— */
    let revenue:any;
    if (country === "GB") {
      const GBPdiscount = +order.discountTotal;
      const GBPship     = +order.shippingTotal;
      const GBPcost     = totalCost;
      let   GBPtotal    = +order.totalAmount;

      const USDdiscount = GBPdiscount / USDGBP;
      const USDship     = GBPship     / USDGBP;
      const USDcost     = GBPcost     / USDGBP;
      let   USDtotal    = GBPtotal    / USDGBP;

      const EURdiscount = GBPdiscount * (USDEUR / USDGBP);
      const EURship     = GBPship     * (USDEUR / USDGBP);
      const EURcost     = GBPcost     * (USDEUR / USDGBP);
      let   EURtotal    = GBPtotal    * (USDEUR / USDGBP);

      if (paymentType === "niftipay") {
        USDtotal = total;
        EURtotal = total * USDEUR;
        GBPtotal = total * USDEUR;
      }

      revenue = (await pool.query(buildInsert(
        USDtotal, USDdiscount, USDship, USDcost,
        GBPtotal, GBPdiscount, GBPship, GBPcost,
        EURtotal, EURdiscount, EURship, EURcost,
      ))).rows[0];

    } else if (euroCountries.includes(country)) {
      const EURdiscount = +order.discountTotal;
      const EURship     = +order.shippingTotal;
      const EURcost     = totalCost;
      let   EURtotal    = +order.totalAmount;

      const USDdiscount = EURdiscount / USDEUR;
      const USDship     = EURship     / USDEUR;
      const USDcost     = EURcost     / USDEUR;
      let   USDtotal    = EURtotal    / USDEUR;

      const GBPdiscount = EURdiscount * (USDGBP / USDEUR);
      const GBPship     = EURship     * (USDGBP / USDEUR);
      const GBPcost     = EURcost     * (USDGBP / USDEUR);
      let   GBPtotal    = EURtotal    * (USDGBP / USDEUR);

      if (paymentType === "niftipay") {
        USDtotal = total;
        EURtotal = total * USDEUR;
        GBPtotal = total * USDGBP;
      }

      revenue = (await pool.query(buildInsert(
        USDtotal, USDdiscount, USDship, USDcost,
        GBPtotal, GBPdiscount, GBPship, GBPcost,
        EURtotal, EURdiscount, EURship, EURcost,
      ))).rows[0];

    } else {
      /* default – USD base */
      const USDdiscount = +order.discountTotal;
      const USDship     = +order.shippingTotal;
      const USDcost     = totalCost;
      let   USDtotal    = +order.totalAmount;

      const EURdiscount = USDdiscount * USDEUR;
      const EURship     = USDship     * USDEUR;
      const EURcost     = USDcost     * USDEUR;
      let   EURtotal    = USDtotal    * USDEUR;

      const GBPdiscount = USDdiscount * USDGBP;
      const GBPship     = USDship     * USDGBP;
      const GBPcost     = USDcost     * USDGBP;
      let   GBPtotal    = USDtotal    * USDGBP;

      if (paymentType === "niftipay") {
        USDtotal = total;
        EURtotal = total * USDEUR;
        GBPtotal = total * USDGBP;
      }

      revenue = (await pool.query(buildInsert(
        USDtotal, USDdiscount, USDship, USDcost,
        GBPtotal, GBPdiscount, GBPship, GBPcost,
        EURtotal, EURdiscount, EURship, EURcost,
      ))).rows[0];
    }

    /* ————— per‑category inserts ————— */
    for (const ct of newCategories) {
      const catId = uuidv4();
      const insertCat = `
        INSERT INTO "categoryRevenue"
          (id,"categoryId",
           "USDtotal","USDcost",
           "GBPtotal","GBPcost",
           "EURtotal","EURcost",
           "createdAt","updatedAt","organizationId")
        VALUES
          ('${catId}','${ct.categoryId}',
           ${(ct.total / USDGBP).toFixed(2)}, ${(ct.cost / USDGBP).toFixed(2)},
           ${(ct.total * (USDGBP / USDEUR)).toFixed(2)}, ${(ct.cost * (USDGBP / USDEUR)).toFixed(2)},
           ${(ct.total * USDEUR).toFixed(2)}, ${(ct.cost * USDEUR).toFixed(2)},
           NOW(),NOW(),'${organizationId}')`;
      await pool.query(insertCat);
    }

    return NextResponse.json(revenue, { status: 200 });

  } catch (err:any) {
    /* ————— safe logging & response ————— */
    console.error("POST /api/order/:id/report", {
      message: err?.message,
      stack:   err?.stack,
    });
    return NextResponse.json(
      { error: err?.message ?? "Internal server error", stack: err?.stack },
      { status: 500 },
    );
  }
}
