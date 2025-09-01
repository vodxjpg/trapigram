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

function extractDropshipper(
  meta: unknown,
): { orgId: string | null; name: string | null } {
  const arr = asArray(meta);
  for (let i = arr.length - 1; i >= 0; i--) {
    const m = arr[i];
    if (m && m.type === "dropshipper" && typeof m.organizationId === "string") {
      return {
        orgId: m.organizationId,
        name: typeof m.name === "string" ? m.name : null,
      };
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

/**
 * Fallback: infer immediate downstream org for legacy orders with empty orderMeta.
 * Strategy:
 *  1) Preferred: via sharedProductMapping using this supplier order's productIds:
 *     cp.productId -> sharedProductMapping.targetProductId -> products.organizationId (downstream)
 *  2) Last resort: if orderKey starts with "S-", strip prefix and take the base order's organizationId.
 */
async function inferDownstreamOrgId(
  orderId: string,
  cartId: string,
  orderKey: string | null,
): Promise<string | null> {
  try {
    // 1) Via product mapping (strongest)
    const prodQ = await pool.query(
      `SELECT DISTINCT cp."productId" AS pid
         FROM "cartProducts" cp
        WHERE cp."cartId" = $1
          AND cp."productId" IS NOT NULL`,
      [cartId],
    );
    for (const row of prodQ.rows as Array<{ pid: string }>) {
      const mapQ = await pool.query(
        `SELECT "targetProductId" FROM "sharedProductMapping"
          WHERE "sourceProductId" = $1 LIMIT 1`,
        [row.pid],
      );
      const targetId = mapQ.rows[0]?.targetProductId as string | undefined;
      if (targetId) {
        const orgQ = await pool.query(
          `SELECT "organizationId" FROM "products" WHERE id = $1 LIMIT 1`,
          [targetId],
        );
        const orgId = orgQ.rows[0]?.organizationId as string | undefined;
        if (orgId) return orgId;
      }
    }
    // 2) Last resort by base order key (covers first hop)
    if (orderKey && orderKey.startsWith("S-")) {
      const base = orderKey.slice(2);
      const baseQ = await pool.query(
        `SELECT "organizationId" FROM "orders" WHERE "orderKey" = $1 LIMIT 1`,
        [base],
      );
      return (baseQ.rows[0]?.organizationId as string) ?? null;
    }
  } catch {
    /* ignore and fall through */
  }
  return null;
}

/* --------------------------------------------------------------- */
/* GET                                                             */
/* --------------------------------------------------------------- */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const currencyRaw = (url.searchParams.get("currency") || "USD").toUpperCase();
  const dropshipperOrgIdFilter = url.searchParams.get("dropshipperOrgId") || "";

  if (!from || !to) {
    return NextResponse.json(
      { error: "Missing required query parameters `from` and `to`." },
      { status: 400 },
    );
  }

  const currency = (["USD", "GBP", "EUR"] as const).includes(
    currencyRaw as any,
  )
    ? (currencyRaw as "USD" | "GBP" | "EUR")
    : "USD";

  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    /* ------------------------------------------------------------- */
    /* Fetch orders in range (no dropshipper filter in SQL)          */
    /* ------------------------------------------------------------- */
    const baseValsOrders: any[] = [organizationId, from, to];
    const revenueQuery = `
      SELECT
          o.id            AS id,
          o."cartId"      AS "cartId",
          o."datePaid",
          o."orderKey"    AS "orderNumber",
          o."clientId"    AS "userId",
          o.country,
          c.username,
          r."${currency}total"    AS "totalPrice",
          r."${currency}shipping" AS "shippingCost",
          r."${currency}discount" AS "discount",
          r."${currency}cost"     AS "cost",
          r.cancelled, r.refunded,
          o."orderMeta"   AS asset
      FROM "orderRevenue" r
      JOIN orders o
        ON r."orderId" = o.id
      JOIN clients c
        ON o."clientId" = c.id
      WHERE
          r."organizationId" = $1
          AND o."datePaid" BETWEEN $2::timestamptz AND $3::timestamptz
      ORDER BY o."orderKey" DESC
    `;
    const revenueRes = await pool.query(revenueQuery, baseValsOrders);

    // Enrich rows: coin, netProfit, dropshipper (with inference)
    const dropshipperMap = new Map<string, string>(); // orgId -> label
    const enriched = await Promise.all(
      revenueRes.rows.map(async (m: any) => {
        // coin (best-effort)
        if (Array.isArray(m.asset) && m.asset.length > 0) {
          m.coin = m.asset[0]?.order?.asset ?? "";
        } else {
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
          Number(m.totalPrice) -
          Number(m.shippingCost) -
          Number(m.discount) -
          Number(m.cost);

        // dropshipper fields (fallback inference like order detail page)
        const drop = extractDropshipper(m.asset);
        let dsOrgId: string | null = drop.orgId ?? null;
        if (!dsOrgId) {
          dsOrgId = await inferDownstreamOrgId(m.id, m.cartId, m.orderNumber);
        }
        let dsLabel: string | null = drop.name ?? null;
        if (!dsLabel && dsOrgId) {
          dsLabel = await resolveDropshipperLabel(dsOrgId);
        }
        m.dropshipperOrgId = dsOrgId;
        m.dropshipperLabel = dsLabel;

        if (m.dropshipperOrgId && m.dropshipperLabel) {
          dropshipperMap.set(m.dropshipperOrgId, m.dropshipperLabel);
        }
        return m;
      }),
    );

    // Apply dropshipper filter in-memory (works for legacy orders too)
    const orders = dropshipperOrgIdFilter
      ? enriched.filter((m: any) => m.dropshipperOrgId === dropshipperOrgIdFilter)
      : enriched;

    // Countries based on filtered orders
    const countries = Array.from(
      new Set(orders.map((o: any) => o.country).filter(Boolean)),
    ).sort();

    // Build chart data from filtered orders (paid only)
    const byDay = orders.reduce((acc: any, o: any) => {
      if (o.cancelled || o.refunded) return acc;
      const key = new Date(o.datePaid).toISOString().split("T")[0];
      const total = Number(o.totalPrice) || 0;
      const discount = Number(o.discount) || 0;
      const shipping = Number(o.shippingCost) || 0;
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

    // options for the UI dropdown (from all enriched orders within the range)
    const dropshippers = Array.from(dropshipperMap.entries()).map(
      ([orgId, label]) => ({
        orgId,
        label,
      }),
    );

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
