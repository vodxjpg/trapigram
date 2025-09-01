// app/api/report/suppliers/route.ts
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

const EURO_COUNTRIES = new Set([
  "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT","LV","LT","LU","MT","NL","PT","SK","SI","ES"
]);

async function resolveOrgLabel(orgId: string | null): Promise<string | null> {
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
    } catch { /* ignore malformed */ }
  }
  return email ? `${orgName} (${email})` : orgName;
}

type Rates = { USDEUR: number; USDGBP: number };
async function getLatestRates(): Promise<Rates> {
  const { rows } = await pool.query(
    `SELECT "EUR","GBP" FROM "exchangeRate" ORDER BY date DESC LIMIT 1`,
  );
  const USDEUR = Number(rows[0]?.EUR ?? 0) || 0;
  const USDGBP = Number(rows[0]?.GBP ?? 0) || 0;
  if (!USDEUR || !USDGBP) {
    // Fallback constants if table is empty (should rarely happen)
    return { USDEUR: 0.92, USDGBP: 0.78 };
  }
  return { USDEUR, USDGBP };
}

function convertByCountry(amountLocal: number, country: string, to: "USD"|"GBP"|"EUR", rates: Rates) {
  const { USDEUR, USDGBP } = rates;
  if (country === "GB") {
    // base = GBP
    if (to === "GBP") return amountLocal;
    if (to === "USD") return amountLocal / USDGBP;
    // to EUR
    return amountLocal * (USDEUR / USDGBP);
  }
  if (EURO_COUNTRIES.has(country)) {
    // base = EUR
    if (to === "EUR") return amountLocal;
    if (to === "USD") return amountLocal / USDEUR;
    // to GBP
    return amountLocal * (USDGBP / USDEUR);
  }
  // assume base = USD
  if (to === "USD") return amountLocal;
  if (to === "GBP") return amountLocal * USDGBP;
  return amountLocal * USDEUR; // EUR
}

/* --------------------------------------------------------------- */
/* GET – list payables lines + daily chart                         */
/* --------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const currencyRaw = (url.searchParams.get("currency") || "USD").toUpperCase() as "USD"|"GBP"|"EUR";
  const supplierOrgIdFilter = url.searchParams.get("supplierOrgId") || ""; // optional
  const statusFilter = (url.searchParams.get("status") || "all") as "all"|"paid"|"cancelled"|"refunded";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required query parameters `from` and `to`." },
      { status: 400 },
    );
  }
  const currency: "USD"|"GBP"|"EUR" = (["USD","GBP","EUR"] as const).includes(currencyRaw) ? currencyRaw : "USD";

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const vals: any[] = [organizationId, from, to];
    let supplierSql = "";
    if (supplierOrgIdFilter) {
      supplierSql = ` AND psrc."organizationId" = $${vals.length + 1}`;
      vals.push(supplierOrgIdFilter);
    }

    // Only include cart lines that were created from a shared product mapping (i.e., you owe a supplier).
    // We also join orderRevenue to read refund/cancel flags to support status filter & consistent logic.
    const sql = `
      SELECT
        o.id                         AS "orderId",
        o."orderKey"                 AS "orderNumber",
        o."datePaid"                 AS "datePaid",
        o.country                    AS country,
        c.username                   AS username,
        r.cancelled                  AS cancelled,
        r.refunded                   AS refunded,
        cp.quantity                  AS quantity,
        pt.title                     AS "productTitle",
        sp.cost                      AS "transferCostJson",
        psrc."organizationId"        AS "supplierOrgId"
      FROM orders o
      JOIN "orderRevenue" r
        ON r."orderId" = o.id
      JOIN clients c
        ON c.id = o."clientId"
      JOIN "cartProducts" cp
        ON cp."cartId" = o."cartId"
       AND cp."productId" IS NOT NULL
      JOIN products pt
        ON pt.id = cp."productId"
      LEFT JOIN "sharedProductMapping" m
        ON m."targetProductId" = cp."productId"
      LEFT JOIN products psrc
        ON psrc.id = m."sourceProductId"
      LEFT JOIN "sharedProduct" sp
        ON sp."shareLinkId" = m."shareLinkId"
       AND sp."productId"   = m."sourceProductId"
      WHERE o."organizationId" = $1
        AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
        AND m."sourceProductId" IS NOT NULL
        ${supplierSql}
      ORDER BY o."datePaid" DESC, o."orderKey" DESC
    `;
    const res = await pool.query(sql, vals);

    const { USDEUR, USDGBP } = await getLatestRates();

    // in-memory status filter
    const statusPass = (row: any) => {
      if (statusFilter === "paid") return row.cancelled === false && row.refunded === false;
      if (statusFilter === "cancelled") return row.cancelled === true;
      if (statusFilter === "refunded") return row.refunded === true;
      return true; // all
    };

    // Prepare sets for dropdowns
    const supplierSet = new Set<string>();
    const countrySet = new Set<string>();

    // Preload labels cache
    const labelCache = new Map<string, string>();

    const lines = await Promise.all(
      res.rows
        .filter(statusPass)
        .map(async (row: any) => {
          const country = row.country as string;
          countrySet.add(country);

          const supplierOrgId: string | null = row.supplierOrgId ?? null;
          let supplierLabel: string | null = null;
          if (supplierOrgId) {
            supplierSet.add(supplierOrgId);
            if (labelCache.has(supplierOrgId)) {
              supplierLabel = labelCache.get(supplierOrgId)!;
            } else {
              supplierLabel = await resolveOrgLabel(supplierOrgId);
              if (supplierLabel) labelCache.set(supplierOrgId, supplierLabel);
            }
          }

          // unit transfer in local currency
          let unitLocal = 0;
          if (row.transferCostJson) {
            const j = typeof row.transferCostJson === "string"
              ? (() => { try { return JSON.parse(row.transferCostJson); } catch { return {}; } })()
              : row.transferCostJson;
            const v = j?.[country];
            unitLocal = Number(v || 0) || 0;
          }
          const unit = convertByCountry(unitLocal, country, currency, { USDEUR, USDGBP });
          const qty = Number(row.quantity || 0);
          const lineTotal = unit * qty;

          return {
            orderId: row.orderId as string,
            orderNumber: row.orderNumber as string,
            datePaid: row.datePaid as string,
            username: row.username as string,
            country,
            cancelled: !!row.cancelled,
            refunded: !!row.refunded,
            supplierOrgId,
            supplierLabel,
            productTitle: row.productTitle as string,
            quantity: qty,
            unitCost: unit,
            lineTotal,
          };
        })
    );

    // Countries (sorted)
    const countries = Array.from(countrySet).filter(Boolean).sort();

    // Suppliers dropdown
    const suppliers = await Promise.all(
      Array.from(supplierSet).map(async (orgId) => ({
        orgId,
        label: labelCache.get(orgId) ?? (await resolveOrgLabel(orgId)) ?? orgId,
      }))
    );

    // Chart: daily sum of lineTotal for non-cancelled & non-refunded (paid only)
    const paidOnly = lines.filter(l => !l.cancelled && !l.refunded);
    const byDay = paidOnly.reduce<Record<string, number>>((acc, l) => {
      const key = new Date(l.datePaid).toISOString().split("T")[0];
      acc[key] = (acc[key] ?? 0) + l.lineTotal;
      return acc;
    }, {});
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days = eachDay(fromDate, toDate);
    const chartData = days.map((d) => {
      const k = d.toISOString().split("T")[0];
      return { date: k, owed: byDay[k] ?? 0 };
    });

    return NextResponse.json(
      { lines, countries, suppliers, chartData },
      { status: 200 },
    );
  } catch (err) {
    console.error("Error fetching supplier payables:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
