import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* ────────────────────────────────────────────────────────── *
 * Types & helpers
 * ────────────────────────────────────────────────────────── */

type Period = { from: Date; to: Date };

function eachDayUTC(from: Date, to: Date) {
    // half-open: yields all dates d with from <= d < to
    const days: Date[] = [];
    const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
    while (cur < end) {
        days.push(new Date(cur));
        cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return days;
}

function normalizeHalfOpen(fromISO: string, toISO: string): Period {
    const from = new Date(fromISO);
    const to = new Date(toISO);
    // If caller gave a date-only “to”, interpret as end of that day + 1
    // (we’ll just trust the provided ISO; the key is using < to in SQL)
    return { from, to };
}

function previousPeriodOf(p: Period): Period {
    const spanMs = p.to.getTime() - p.from.getTime(); // half-open
    const prevTo = new Date(p.from.getTime());        // previous ends where current starts
    const prevFrom = new Date(prevTo.getTime() - spanMs);
    return { from: prevFrom, to: prevTo };
}

function percentChange(cur: number, prev: number): number {
    if (prev > 0) return ((cur - prev) / prev) * 100;
    // define: if prev == 0 -> 100% when cur>0, else 0%
    return cur > 0 ? 100 : 0;
}

/* Whitelist currency → column names */
const CURRENCY = {
    USD: { total: `"USDtotal"`, discount: `"USDdiscount"`, shipping: `"USDshipping"`, cost: `"USDcost"` },
    EUR: { total: `"EURtotal"`, discount: `"EURdiscount"`, shipping: `"EURshipping"`, cost: `"EURcost"` },
    GBP: { total: `"GBPtotal"`, discount: `"GBPdiscount"`, shipping: `"GBPshipping"`, cost: `"GBPcost"` },
} as const;

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const currencyParam = (url.searchParams.get("currency") || "USD").toUpperCase() as keyof typeof CURRENCY;

    if (!from || !to) {
        return NextResponse.json(
            { error: "Missing required query parameters `from` and `to`." },
            { status: 400 }
        );
    }
    if (!CURRENCY[currencyParam]) {
        return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });
    }
    const curCols = CURRENCY[currencyParam];

    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        /* Periods */
        const current = normalizeHalfOpen(from, to);
        const previous = previousPeriodOf(current);

        /* Common params (half-open intervals): createdAt/updatedAt >= from AND < to */
        const curRange = [organizationId, current.from, current.to] as const;
        const prevRange = [organizationId, previous.from, previous.to] as const;

        /* ─────────────────────────────────────────────────────
           Orders (count) – use createdAt; keep your original
           ───────────────────────────────────────────────────── */
        const ordersSQL = `
      SELECT COUNT(*)::int AS n
      FROM "orders"
      WHERE "organizationId" = $1
        AND "createdAt" >= $2::timestamptz
        AND "createdAt" <  $3::timestamptz
    `;
        const { rows: [ordCur] } = await pool.query(ordersSQL, curRange);
        const orderAmount: number = Number(ordCur?.n ?? 0);

        /* ─────────────────────────────────────────────────────
           Revenue (profit) for current period
           Use orderRevenue with same filters & currency aliases,
           based on the revenue record timestamps. If you prefer
           paid time, join orders and use o.datePaid consistently.
           ───────────────────────────────────────────────────── */
        const revenueSQL = `
      SELECT
        ${curCols.total}   AS total,
        ${curCols.discount} AS discount,
        ${curCols.shipping} AS shipping,
        ${curCols.cost}     AS cost
      FROM "orderRevenue"
      WHERE "organizationId" = $1
        AND "createdAt" >= $2::timestamptz
        AND "createdAt" <  $3::timestamptz
        AND cancelled = FALSE
        AND refunded  = FALSE
    `;
        const { rows: revRows } = await pool.query(revenueSQL, curRange);
        const revenue = revRows.reduce((acc, r) => {
            const total = Number(r.total || 0);
            const discount = Number(r.discount || 0);
            const shipping = Number(r.shipping || 0);
            const cost = Number(r.cost || 0);
            return acc + (total - discount - shipping - cost);
        }, 0);

        /* ─────────────────────────────────────────────────────
           New customers (createdAt)
           ───────────────────────────────────────────────────── */
        const clientsSQL = `
      SELECT COUNT(*)::int AS n
      FROM "clients"
      WHERE "organizationId" = $1
        AND "createdAt" >= $2::timestamptz
        AND "createdAt" <  $3::timestamptz
    `;
        const { rows: [cliCur] } = await pool.query(clientsSQL, curRange);
        const clientAmount: number = Number(cliCur?.n ?? 0);

        const { rows: [cliPrev] } = await pool.query(clientsSQL, prevRange);
        const clientsPrev: number = Number(cliPrev?.n ?? 0);
        const clientGrowth = percentChange(clientAmount, clientsPrev);

        /* ─────────────────────────────────────────────────────
           Active users (updatedAt)
           ───────────────────────────────────────────────────── */
        const activeSQL = `
      SELECT COUNT(*)::int AS n
      FROM "clients"
      WHERE "organizationId" = $1
        AND "updatedAt" >= $2::timestamptz
        AND "updatedAt" <  $3::timestamptz
    `;
        const { rows: [actCur] } = await pool.query(activeSQL, curRange);
        const activeAmount: number = Number(actCur?.n ?? 0);

        const { rows: [actPrev] } = await pool.query(activeSQL, prevRange);
        const activesPrev: number = Number(actPrev?.n ?? 0);
        const activeGrowth = percentChange(activeAmount, activesPrev);

        /* ─────────────────────────────────────────────────────
           Recent orders list (last 10 by paid date if available;
           fallback to createdAt). Parameterized.
           ───────────────────────────────────────────────────── */
        const orderListSQL = `
      SELECT o.id, o."orderKey", o.status,
             COALESCE(o."datePaid", o."createdAt") AS date,
             o."totalAmount",
             c."firstName", c."lastName", c."username", c.email
      FROM orders o
      JOIN clients c ON c.id = o."clientId"
      WHERE o."organizationId" = $1
      ORDER BY date DESC
      LIMIT 10
    `;
        const { rows: orderList } = await pool.query(orderListSQL, [organizationId]);
        const orderSorted = orderList.map((od) => ({
            id: od.id,
            orderNumber: od.orderKey,
            user: `${od.firstName ?? ""} ${od.lastName ?? ""} - ${od.username ?? ""} (${od.email ?? ""})`.trim(),
            status: od.status,
            date: od.date,
            total: Number(od.totalAmount ?? 0),
        }));

        /* ─────────────────────────────────────────────────────
           Chart (daily totals & revenue by paid date)
           If you strictly want paid-time revenue, we compute profit in SQL.
           ───────────────────────────────────────────────────── */
        const chartSQL = `
      SELECT
        DATE(o."datePaid") AS day,
        SUM(${curCols.total})   AS total,
        SUM(${curCols.total} - ${curCols.discount} - ${curCols.shipping} - ${curCols.cost}) AS revenue
      FROM "orderRevenue" r
      JOIN orders o ON o.id = r."orderId"
      WHERE r."organizationId" = $1
        AND o."datePaid" >= $2::timestamptz
        AND o."datePaid" <  $3::timestamptz
        AND r.cancelled = FALSE
        AND r.refunded  = FALSE
      GROUP BY 1
      ORDER BY 1 ASC
    `;
        const { rows: chartRows } = await pool.query(chartSQL, curRange);
        const byDay: Record<string, { total: number; revenue: number }> = {};
        for (const r of chartRows) {
            const key = (r.day instanceof Date ? r.day : new Date(r.day)).toISOString().slice(0, 10);
            byDay[key] = {
                total: Number(r.total || 0),
                revenue: Number(r.revenue || 0),
            };
        }

        const days = eachDayUTC(current.from, current.to);
        const chartData = days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            return {
                date: key,
                total: byDay[key]?.total ?? 0,
                revenue: byDay[key]?.revenue ?? 0,
            };
        });

        /* ─────────────────────────────────────────────────────
           Revenue growth (previous period, same filters/columns)
           ───────────────────────────────────────────────────── */
        const { rows: revPrevRows } = await pool.query(revenueSQL, prevRange);
        const revenuePrev = revPrevRows.reduce((acc, r) => {
            const total = Number(r.total || 0);
            const discount = Number(r.discount || 0);
            const shipping = Number(r.shipping || 0);
            const cost = Number(r.cost || 0);
            return acc + (total - discount - shipping - cost);
        }, 0);
        const growthRate = percentChange(revenue, revenuePrev);

        return NextResponse.json(
            {
                orderAmount,
                revenue,
                clientAmount,
                clientGrowth,
                activeAmount,
                activeGrowth,
                orderList: orderSorted,
                chartData,
                growthRate,
            },
            { status: 200 }
        );
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
