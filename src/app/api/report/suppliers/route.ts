// app/api/report/suppliers/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

/* --------------------------------------------------------------- */
/* helpers                                                         */
/* --------------------------------------------------------------- */
type NormStatus =
  | "paid"
  | "pending_payment"
  | "refunded"
  | "cancelled"
  | "open"
  | "partially_paid";

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
  "AT",
  "BE",
  "HR",
  "CY",
  "EE",
  "FI",
  "FR",
  "DE",
  "GR",
  "IE",
  "IT",
  "LV",
  "LT",
  "LU",
  "MT",
  "NL",
  "PT",
  "SK",
  "SI",
  "ES",
]);

async function resolveOrgLabel(orgId: string | null): Promise<string | null> {
  if (!orgId) return null;
  const orgQ = await pool.query(
    `SELECT name, metadata FROM "organization" WHERE id = $1 LIMIT 1`,
    [orgId]
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
          [tenantId]
        );
        email = (tQ.rows[0]?.ownerEmail as string) ?? null;
      }
    } catch {
      /* ignore malformed */
    }
  }
  return email ? `${orgName} (${email})` : orgName;
}

type Rates = { USDEUR: number; USDGBP: number };
async function getLatestRates(): Promise<Rates> {
  const { rows } = await pool.query(
    `SELECT "EUR","GBP" FROM "exchangeRate" ORDER BY date DESC LIMIT 1`
  );
  const USDEUR = Number(rows[0]?.EUR ?? 0) || 0;
  const USDGBP = Number(rows[0]?.GBP ?? 0) || 0;
  if (!USDEUR || !USDGBP) {
    // Fallback constants if table is empty (should rarely happen)
    return { USDEUR: 0.92, USDGBP: 0.78 };
  }
  return { USDEUR, USDGBP };
}

function convertByCountry(
  amountLocal: number,
  country: string,
  to: "USD" | "GBP" | "EUR",
  rates: Rates
) {
  const { USDEUR, USDGBP } = rates;
  if (country === "GB") {
    if (to === "GBP") return amountLocal; // base GBP
    if (to === "USD") return amountLocal / USDGBP;
    return amountLocal * (USDEUR / USDGBP); // → EUR
  }
  if (EURO_COUNTRIES.has(country)) {
    if (to === "EUR") return amountLocal; // base EUR
    if (to === "USD") return amountLocal / USDEUR;
    return amountLocal * (USDGBP / USDEUR); // → GBP
  }
  // base USD
  if (to === "USD") return amountLocal;
  if (to === "GBP") return amountLocal * USDGBP;
  return amountLocal * USDEUR; // → EUR
}

function normalizeStatus(row: any): NormStatus {
  if (row?.cancelled) return "cancelled";
  if (row?.refunded) return "refunded";
  const raw = String(row?.status ?? "").toLowerCase().trim();
  if (raw.includes("pending")) return "pending_payment";
  if (raw.includes("partial")) return "partially_paid";
  if (raw.includes("cancel")) return "cancelled";
  if (raw.includes("refund")) return "refunded";
  if (raw.includes("complete")) return "paid";
  if (raw.includes("paid")) return "paid";
  if (raw.includes("open") || raw.includes("new")) return "open";
  return "open";
}

/* --------------------------------------------------------------- */
/* types + grouping                                                */
/* --------------------------------------------------------------- */
type Line = {
  orderId: string;
  orderNumber: string;
  datePaid: string; // COALESCE(datePaid, dateCreated)
  username: string;
  country: string;
  cancelled: boolean;
  refunded: boolean;
  status: NormStatus; // normalized
  supplierOrgId: string | null;
  supplierLabel: string | null;
  productTitle: string;
  quantity: number;
  unitCost: number;
  lineTotal: number;
};

type GroupedOrder = {
  orderId: string;
  orderNumber: string;
  datePaid: string;
  username: string;
  country: string;
  cancelled: boolean;
  refunded: boolean;
  status: NormStatus; // <- include status on the grouped row so UI can show it
  supplierOrgId: string | null;
  supplierLabel: string | null;
  items: Array<{
    productTitle: string;
    quantity: number;
    unitCost: number;
    lineTotal: number;
  }>;
  totalQty: number;
  totalOwed: number;
};

function groupByOrderAndSupplier(lines: Line[]): GroupedOrder[] {
  const map = new Map<string, GroupedOrder>();

  for (const l of lines) {
    const key = `${l.orderId}__${l.supplierOrgId ?? "none"}`;
    let g = map.get(key);
    if (!g) {
      g = {
        orderId: l.orderId,
        orderNumber: l.orderNumber,
        datePaid: l.datePaid,
        username: l.username,
        country: l.country,
        cancelled: l.cancelled,
        refunded: l.refunded,
        status: l.status, // propagate status
        supplierOrgId: l.supplierOrgId,
        supplierLabel: l.supplierLabel,
        items: [],
        totalQty: 0,
        totalOwed: 0,
      };
      map.set(key, g);
    }
    g.items.push({
      productTitle: l.productTitle,
      quantity: l.quantity,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
    });
    g.totalQty += Number(l.quantity || 0);
    g.totalOwed += Number(l.lineTotal || 0);
  }

  // Apply business rules on the grouped totals
  const grouped = Array.from(map.values());
  for (const g of grouped) {
    if (g.cancelled) {
      g.totalOwed = 0; // cancelled => owe nothing
    } else if (g.refunded) {
      g.totalOwed = -Math.abs(g.totalOwed); // refunded => negative owed
    }
  }

  return grouped.sort(
    (a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime()
  );
}

/* --------------------------------------------------------------- */
/* GET – grouped payables (Order × Supplier) + daily chart         */
/* --------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const currencyRaw = (url.searchParams.get("currency") || "USD").toUpperCase() as
    | "USD"
    | "GBP"
    | "EUR";
  const supplierOrgIdFilter = url.searchParams.get("supplierOrgId") || ""; // optional
  const statusFilter = (url.searchParams.get("status") || "all") as
    | "all"
    | "paid"
    | "pending_payment"
    | "cancelled"
    | "refunded";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required query parameters `from` and `to`." },
      { status: 400 }
    );
  }
  const currency: "USD" | "GBP" | "EUR" = (["USD", "GBP", "EUR"] as const).includes(
    currencyRaw
  )
    ? currencyRaw
    : "USD";

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

    // NOTE:
    // - Use COALESCE(datePaid, dateCreated) as paidAt to include pending_payment
    //   orders that might not have datePaid yet.
    // - Select o.status so we can normalize and expose it.
    const sql = `
      SELECT
        cp.id                               AS "cartProductId",
        o.id                                AS "orderId",
        o."orderKey"                        AS "orderNumber",
        COALESCE(o."datePaid", o."dateCreated") AS "paidAt",
        o.status                            AS "status",
        o.country                           AS country,
        c.username                          AS username,
        r.cancelled                         AS cancelled,
        r.refunded                          AS refunded,
        cp.quantity                         AS quantity,
        pt.title                            AS "productTitle",
        sp.cost                             AS "transferCostJson",
        psrc."organizationId"               AS "supplierOrgId"
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
        AND COALESCE(o."datePaid", o."dateCreated") BETWEEN $2::timestamptz AND $3::timestamptz
        AND m."sourceProductId" IS NOT NULL
        ${supplierSql}
      ORDER BY COALESCE(o."datePaid", o."dateCreated") DESC, o."orderKey" DESC, cp.id DESC
    `;

    const res = await pool.query(sql, vals);
    const { USDEUR, USDGBP } = await getLatestRates();

    // Server-side status filter
    const statusPass = (row: any) => {
      const s = normalizeStatus(row);
      if (statusFilter === "all") return true;
      if (statusFilter === "paid")
        return s === "paid" && row.cancelled === false && row.refunded === false;
      if (statusFilter === "pending_payment")
        return (
          s === "pending_payment" &&
          row.cancelled === false &&
          row.refunded === false
        );
      if (statusFilter === "cancelled") return row.cancelled === true;
      if (statusFilter === "refunded") return row.refunded === true;
      return true;
    };

    // Prepare sets for dropdowns
    const supplierSet = new Set<string>();
    const countrySet = new Set<string>();

    // Label cache
    const labelCache = new Map<string, string>();

    // De-duplicate by cartProductId
    const seenCartProduct = new Set<string>();

    // Track per-order normalized status
    const orderStatus = new Map<string, NormStatus>();

    const lines: Line[] = [];
    for (const row of res.rows) {
      if (!statusPass(row)) continue;

      const cpId = String(row.cartProductId);
      if (seenCartProduct.has(cpId)) continue;
      seenCartProduct.add(cpId);

      const orderId = String(row.orderId);
      const country = row.country as string;
      countrySet.add(country);

            // Treat mappings that point back to our own org as "in-house" (no supplier)
      let supplierOrgId: string | null = row.supplierOrgId ?? null;
      if (supplierOrgId === organizationId) supplierOrgId = null;
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

      // transfer unit in local currency
      let unitLocal = 0;
      if (row.transferCostJson) {
        const j =
          typeof row.transferCostJson === "string"
            ? (() => {
                try {
                  return JSON.parse(row.transferCostJson);
                } catch {
                  return {};
                }
              })()
            : row.transferCostJson;
        const v = j?.[country];
        unitLocal = Number(v || 0) || 0;
      }
      const unit = convertByCountry(unitLocal, country, currency, {
        USDEUR,
        USDGBP,
      });
      const qty = Number(row.quantity || 0);
      const lineTotal = unit * qty;

      const s = normalizeStatus(row);
      orderStatus.set(orderId, s);

      lines.push({
        orderId,
        orderNumber: row.orderNumber as string,
        datePaid: row.paidAt as string, // coalesced date
        username: row.username as string,
        country,
        cancelled: !!row.cancelled,
        refunded: !!row.refunded,
        status: s,
        supplierOrgId,
        supplierLabel,
        productTitle: row.productTitle as string,
        quantity: qty,
        unitCost: unit,
        lineTotal,
      });
    }

    // Group by Order × Supplier and apply cancelled/refunded rules
    const orders = groupByOrderAndSupplier(lines);

    // Countries (sorted)
    const countries = Array.from(countrySet).filter(Boolean).sort();

    // Suppliers dropdown
    const suppliers = await Promise.all(
      Array.from(supplierSet).map(async (orgId) => ({
        orgId,
        label:
          labelCache.get(orgId) ?? (await resolveOrgLabel(orgId)) ?? orgId,
      }))
    );

    // Chart: daily sum of totalOwed for fully PAID & not cancelled/refunded
    const paidOrders = orders.filter(
      (o) => orderStatus.get(o.orderId) === "paid" && !o.cancelled && !o.refunded
    );
    const byDay = paidOrders.reduce<Record<string, number>>((acc, o) => {
      const key = new Date(o.datePaid).toISOString().split("T")[0];
      acc[key] = (acc[key] ?? 0) + o.totalOwed;
      return acc;
    }, {});
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const days = eachDay(fromDate, toDate);
    const chartData = days.map((d) => {
      const k = d.toISOString().split("T")[0];
      return { date: k, owed: byDay[k] ?? 0 };
    });

    const counts = {
      total: orders.length,
      paid: orders.filter(
        (o) => orderStatus.get(o.orderId) === "paid" && !o.cancelled && !o.refunded
      ).length,
      refunded: orders.filter((o) => o.refunded).length,
      cancelled: orders.filter((o) => o.cancelled).length,
    };

    const sums = orders.reduce(
      (acc, o) => {
        const owed = Number(o.totalOwed) || 0;
        acc.allOrdersNet += owed; // includes negatives for refunded, zero for cancelled
        acc.totalQty += Number(o.totalQty) || 0;
        if (orderStatus.get(o.orderId) === "paid" && !o.cancelled && !o.refunded) {
          acc.paidOrdersNet += owed;
        }
        return acc;
      },
      { allOrdersNet: 0, paidOrdersNet: 0, totalQty: 0 }
    );

    const currencySymbol =
      currency === "USD" ? "$" : currency === "GBP" ? "£" : "€";

    const totals = {
      ...sums, // { allOrdersNet, paidOrdersNet, totalQty }
      counts, // { total, paid, refunded, cancelled }
      currency, // "USD" | "GBP" | "EUR"
      currencySymbol, // "$" | "£" | "€"
    };

    return NextResponse.json(
      { orders, countries, suppliers, chartData, totals },
      { status: 200 }
    );
  } catch (err) {
    console.error("Error fetching supplier payables:", err);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}
