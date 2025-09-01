// app/api/report/revenue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* --------------------------------------------------------------- */
/* helpers                                                         */
/* --------------------------------------------------------------- */
function eachDay(from: Date, to: Date) {
  const days: Date[] = [];
  const cur = new Date(from);
  cur.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);
  while (cur <= end) {
    days.push(new Date(cur));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

// ── dropshipper helpers (same logic used elsewhere) ───────────────
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
      /* ignore malformed metadata */
    }
  }
  return email ? `${orgName} (${email})` : orgName;
}

/* --------------------------------------------------------------- */
/* GET                                                             */
/* --------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const currencyRaw = (url.searchParams.get("currency") || "USD").toUpperCase();
  const dropshipperOrgIdFilter = url.searchParams.get("dropshipperOrgId");

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required query parameters `from` and `to`." },
      { status: 400 },
    );
  }

  const currency = ["USD", "GBP", "EUR"].includes(currencyRaw) ? currencyRaw : "USD";

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    /* ------------------------------------------------------------- */
    /* Countries (respect dropshipper filter)                        */
    /* ------------------------------------------------------------- */
    const baseValsCountries: any[] = [organizationId, from, to];
    let dsFilterCountries = "";
    if (dropshipperOrgIdFilter) {
      dsFilterCountries = ` AND EXISTS (
        SELECT 1
          FROM jsonb_array_elements(COALESCE(o."orderMeta",'[]'::jsonb)) AS e
         WHERE e->>'type' = 'dropshipper'
           AND e->>'organizationId' = $${baseValsCountries.length + 1}
      )`;
      baseValsCountries.push(dropshipperOrgIdFilter);
    }

    const distinctCountriesQuery = `
      SELECT DISTINCT o.country
        FROM "orderRevenue" r
        JOIN orders o ON r."orderId" = o.id
       WHERE r."organizationId" = $1
         AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
         ${dsFilterCountries}
       ORDER BY o.country ASC
    `;
    const distinctResult = await pool.query(distinctCountriesQuery, baseValsCountries);
    const countries: string[] = distinctResult.rows
      .map((r) => r.country as string)
      .filter(Boolean);

    /* ------------------------------------------------------------- */
    /* Orders (respect dropshipper filter)                           */
    /* ------------------------------------------------------------- */
    const baseValsOrders: any[] = [organizationId, from, to];
    let dsFilterOrders = "";
    if (dropshipperOrgIdFilter) {
      dsFilterOrders = ` AND EXISTS (
        SELECT 1
          FROM jsonb_array_elements(COALESCE(o."orderMeta",'[]'::jsonb)) AS e
         WHERE e->>'type' = 'dropshipper'
           AND e->>'organizationId' = $${baseValsOrders.length + 1}
      )`;
      baseValsOrders.push(dropshipperOrgIdFilter);
    }

    const revenueQuery = `
      SELECT
          o."datePaid",
          o."orderKey"   AS "orderNumber",
          o."clientId"   AS "userId",
          o.country,
          c.username,
          r."${currency}total"    AS "totalPrice",
          r."${currency}shipping" AS "shippingCost",
          r."${currency}discount" AS "discount",
          r."${currency}cost"     AS "cost",
          r.cancelled, r.refunded,
          o."orderMeta"  AS asset
      FROM "orderRevenue" r
      JOIN orders o
        ON r."orderId" = o.id
      JOIN clients c
        ON o."clientId" = c.id
      WHERE
          r."organizationId" = $1
          AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
          ${dsFilterOrders}
      ORDER BY o."orderKey" DESC
    `;
    const revenueRes = await pool.query(revenueQuery, baseValsOrders);

    // enrich rows: coin, netProfit, dropshipper
    const dropshipperMap = new Map<string, string>(); // orgId -> label
    const orders = await Promise.all(
      revenueRes.rows.map(async (m: any) => {
        // coin (best-effort, based on first meta entry like current code)
        if (Array.isArray(m.asset) && m.asset.length > 0) {
          m.coin = m.asset[0]?.order?.asset ?? "";
        } else {
          // try to scan from the end for a recent 'order.asset'
          const arr = asArray(m.asset);
          let found = "";
          for (let i = arr.length - 1; i >= 0; i--) {
            const a = arr[i];
            if (a?.order?.asset) {
              found = a.order.asset;
              break;
            }
          }
          m.coin = found;
        }

        // net profit
        m.netProfit =
          Number(m.totalPrice) - Number(m.shippingCost) - Number(m.discount) - Number(m.cost);

        // dropshipper fields
        const drop = extractDropshipper(m.asset);
        let label = drop.name;
        if (!label && drop.orgId) {
          label = await resolveDropshipperLabel(drop.orgId);
        }
        m.dropshipperOrgId = drop.orgId ?? null;
        m.dropshipperLabel = label ?? null;

        if (m.dropshipperOrgId && m.dropshipperLabel) {
          dropshipperMap.set(m.dropshipperOrgId, m.dropshipperLabel);
        }
        return m;
      }),
    );

    /* ------------------------------------------------------------- */
    /* Chart data (respect dropshipper filter)                       */
    /* ------------------------------------------------------------- */
    const baseValsChart: any[] = [organizationId, from, to];
    let dsFilterChart = "";
    if (dropshipperOrgIdFilter) {
      dsFilterChart = ` AND EXISTS (
        SELECT 1
          FROM jsonb_array_elements(COALESCE(o."orderMeta",'[]'::jsonb)) AS e
         WHERE e->>'type' = 'dropshipper'
           AND e->>'organizationId' = $${baseValsChart.length + 1}
      )`;
      baseValsChart.push(dropshipperOrgIdFilter);
    }

    const chartQuery = `
      SELECT
        DATE(o."datePaid")                           AS date,
        r."${currency}total"    AS total,
        r."${currency}shipping" AS shipping,
        r."${currency}discount" AS discount,
        r."${currency}cost"     AS cost
      FROM "orderRevenue" r
      JOIN orders o ON r."orderId" = o.id
      WHERE r."organizationId" = $1
        AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
        AND r.cancelled = FALSE
        AND r.refunded  = FALSE
        ${dsFilterChart}
      ORDER BY o."datePaid" DESC
    `;
    const chartRes = await pool.query(chartQuery, baseValsChart);
    const byDay = chartRes.rows.reduce((acc: any, o: any) => {
      const key = new Date(o.date).toISOString().split("T")[0];
      const total = Number(o.total) || 0;
      const discount = Number(o.discount) || 0;
      const shipping = Number(o.shipping) || 0;
      const cost = Number(o.cost) || 0;
      const revenue = total - discount - shipping - cost;
      if (!acc[key]) acc[key] = { total: 0, revenue: 0 };
      acc[key].total += total;
      acc[key].revenue += revenue;
      return acc;
    }, {});

    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days = eachDay(fromDate, toDate);
    const chartData = days.map((d) => {
      const key = d.toISOString().split("T")[0];
      return {
        date: key,
        total: byDay[key]?.total ?? 0,
        revenue: byDay[key]?.revenue ?? 0,
      };
    });

    // options for the UI dropdown
    const dropshippers = Array.from(dropshipperMap.entries()).map(([orgId, label]) => ({
      orgId,
      label,
    }));

    return NextResponse.json(
      {
        orders,
        countries,
        chartData,
        dropshippers,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error fetching revenue:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
