import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type Kind = "product" | "variation" | "affiliate";

type DailyRow = {
  date: string;    // YYYY-MM-DD
  quantity: number;
};

function daysBetweenInclusive(fromISO: string, toISO: string): string[] {
  const out: string[] = [];
  const from = new Date(fromISO + "T00:00:00");
  const to = new Date(toISO + "T00:00:00");
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function fillMissingDays(rows: DailyRow[], fromISO: string, toISO: string): DailyRow[] {
  const map = new Map(rows.map(r => [r.date, Number(r.quantity) || 0]));
  return daysBetweenInclusive(fromISO, toISO).map(day => ({
    date: day,
    quantity: map.get(day) ?? 0,
  }));
}

// —— Labels for the header (and to mirror into each row if you want)
async function defaultForProduct(productId: string) {
  const q = `SELECT title, sku FROM products WHERE id = $1`;
  const r = await pool.query(q, [productId]);
  const row = r.rows[0] ?? {};
  return { title: row.title ?? "—", sku: row.sku ?? "—" };
}

async function defaultForVariation(productId: string, variationId: string) {
  // Build: ProductTitle - AttrName Term / AttrName Term ...
  const q = `
    SELECT
      p.title AS product_title,
      pv.sku  AS variation_sku,
      COALESCE((
        SELECT string_agg(pa.name || ' ' || pat.name, ' / ' ORDER BY pa.name)
        FROM jsonb_each_text(COALESCE(pv.attributes,'{}'::jsonb)) kv(attributeId, termId)
        JOIN "productAttributes"      pa ON pa.id  = kv.attributeId
        JOIN "productAttributeTerms" pat ON pat.id = kv.termId
      ), '') AS attrs_label
    FROM products p
    JOIN "productVariations" pv ON pv."productId" = p.id AND pv.id = $2
    WHERE p.id = $1
  `;
  const r = await pool.query(q, [productId, variationId]);
  const row = r.rows[0] ?? {};
  const base = row.product_title ?? "—";
  const label = row.attrs_label ? `${base} - ${row.attrs_label}` : base;
  return { title: label, sku: row.variation_sku ?? "—" };
}

async function defaultForAffiliate(affiliateProductId: string) {
  const q = `SELECT title, sku FROM "affiliateProducts" WHERE id = $1`;
  const r = await pool.query(q, [affiliateProductId]);
  const row = r.rows[0] ?? {};
  return { title: row.title ?? "—", sku: row.sku ?? "—" };
}

export async function GET(req: NextRequest) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { searchParams } = new URL(req.url);
    const kind = (searchParams.get("kind") ?? "") as Kind;
    const productId = searchParams.get("productId");
    const variationId = searchParams.get("variationId");
    const affiliateProductId = searchParams.get("affiliateProductId");
    const from = searchParams.get("from"); // YYYY-MM-DD
    const to = searchParams.get("to");   // YYYY-MM-DD

    if (!["product", "variation", "affiliate"].includes(kind)) {
      return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
    }
    if (!from || !to) {
      return NextResponse.json({ error: "Missing from/to (YYYY-MM-DD)" }, { status: 400 });
    }
    if (kind === "product" && !productId) {
      return NextResponse.json({ error: "Missing productId for kind=product" }, { status: 400 });
    }
    if (kind === "variation" && (!productId || !variationId)) {
      return NextResponse.json({ error: "Missing productId or variationId for kind=variation" }, { status: 400 });
    }
    if (kind === "affiliate" && !affiliateProductId) {
      return NextResponse.json({ error: "Missing affiliateProductId for kind=affiliate" }, { status: 400 });
    }

    // We will group strictly by the *order* timestamp to match monthly/global
    // Range: from <= createdAt < (to + 1 day)
    const statuses = ["completed", "paid", "pending_payment"];

    let rows: DailyRow[] = [];

    if (kind === "product") {
      const q = `
        SELECT
          to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS date,
          SUM(cp.quantity)::bigint AS quantity
        FROM orders o
        JOIN "cartProducts" cp ON cp."cartId" = o."cartId"
        WHERE o."organizationId" = $1
          AND o.status = ANY($2)
          AND o."createdAt" >= ($3::date)
          AND o."createdAt" <  (($4::date + INTERVAL '1 day'))
          AND cp."productId" = $5
          AND cp."variationId" IS NULL
          AND cp."affiliateProductId" IS NULL
        GROUP BY date
        ORDER BY date ASC
      `;
      const r = await pool.query(q, [organizationId, statuses, from, to, productId]);
      rows = r.rows;
      if (rows.length === 0) {
        const def = await defaultForProduct(productId!);
        const daily = fillMissingDays([], from, to).map(d => ({ ...d, title: def.title, sku: def.sku }));
        return NextResponse.json({ kind, productId, title: def.title, sku: def.sku, daily }, { status: 200 });
      }
      const def = await defaultForProduct(productId!);
      const filled = fillMissingDays(rows, from, to).map(d => ({ ...d, title: def.title, sku: def.sku }));
      return NextResponse.json({ kind, productId, title: def.title, sku: def.sku, daily: filled }, { status: 200 });
    }

    if (kind === "variation") {
      const q = `
        SELECT
          to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS date,
          SUM(cp.quantity)::bigint AS quantity
        FROM orders o
        JOIN "cartProducts" cp ON cp."cartId" = o."cartId"
        WHERE o."organizationId" = $1
          AND o.status = ANY($2)
          AND o."createdAt" >= ($3::date)
          AND o."createdAt" <  (($4::date + INTERVAL '1 day'))
          AND cp."productId"   = $5
          AND cp."variationId" = $6
        GROUP BY date
        ORDER BY date ASC
      `;
      const r = await pool.query(q, [organizationId, statuses, from, to, productId, variationId]);
      rows = r.rows;
      const def = await defaultForVariation(productId!, variationId!);
      const filled = fillMissingDays(rows, from, to).map(d => ({ ...d, title: def.title, sku: def.sku }));
      return NextResponse.json({ kind, productId, variationId, title: def.title, sku: def.sku, daily: filled }, { status: 200 });
    }

    // affiliate
    const q = `
      SELECT
        to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS date,
        SUM(cp.quantity)::bigint AS quantity
      FROM orders o
      JOIN "cartProducts" cp ON cp."cartId" = o."cartId"
      WHERE o."organizationId" = $1
        AND o.status = ANY($2)
        AND o."createdAt" >= ($3::date)
        AND o."createdAt" <  (($4::date + INTERVAL '1 day'))
        AND cp."affiliateProductId" = $5
      GROUP BY date
      ORDER BY date ASC
    `;
    const r = await pool.query(q, [organizationId, statuses, from, to, affiliateProductId]);
    rows = r.rows;
    const def = await defaultForAffiliate(affiliateProductId!);
    const filled = fillMissingDays(rows, from, to).map(d => ({ ...d, title: def.title, sku: def.sku }));
    return NextResponse.json({ kind, affiliateProductId, title: def.title, sku: def.sku, daily: filled }, { status: 200 });

  } catch (err) {
    console.error("[GET /api/report/product/daily] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
