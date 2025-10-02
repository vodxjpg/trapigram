// src/app/api/report/product/monthly/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type Kind = "product" | "variation" | "affiliate";

type Row = { month: string; quantity: number };
type MonthlyPoint = { month: string; quantity: number };

function monthsOfYear(year: number): string[] {
    const out: string[] = [];
    for (let m = 1; m <= 12; m++) out.push(`${year}-${String(m).padStart(2, "0")}`);
    return out;
}

function fillMissingMonths(rows: Row[], year: number): MonthlyPoint[] {
    const map = new Map<string, number>(
        rows.map((r) => [r.month, Number(r.quantity) || 0])
    );
    return monthsOfYear(year).map((key) => ({
        month: key,
        quantity: map.get(key) ?? 0,
    }));
}

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { searchParams } = new URL(req.url);
        const kind = (searchParams.get("kind") ?? "") as Kind;
        const productId = searchParams.get("productId") ?? undefined;
        const variationId = searchParams.get("variationId") ?? undefined;
        const affiliateProductId = searchParams.get("affiliateProductId") ?? undefined;
        const year = Number(searchParams.get("year") ?? new Date().getFullYear());

        if (!["product", "variation", "affiliate"].includes(kind)) {
            return NextResponse.json({ error: "Invalid kind" }, { status: 400 });
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

        // Pull all carts for the target calendar year (inclusive of Jan 1, exclusive of next Jan 1)
        const from = `${year}-01-01`;
        const toNext = `${year + 1}-01-01`;
        const statuses = ["completed", "paid", "pending_payment"];

        const cartsRes = await pool.query(
            `SELECT "cartId"
         FROM orders
        WHERE "organizationId" = $1
          AND status = ANY($2)
          AND "createdAt" >= ($3::date)
          AND "createdAt" <  ($4::date)`,
            [organizationId, statuses, from, toNext]
        );
        const cartIds: string[] = cartsRes.rows.map((r) => r.cartId).filter(Boolean);

        // If there were no carts at all, still return 12 months with zeros
        if (cartIds.length === 0) {
            const monthly = fillMissingMonths([], year);
            return NextResponse.json({ monthly }, { status: 200 });
        }

        let rows: Row[] = [];

        if (kind === "product") {
            const q = `
        SELECT
          to_char(date_trunc('month', cp."createdAt"), 'YYYY-MM') AS month,
          SUM(cp.quantity)::bigint AS quantity
        FROM "cartProducts" cp
        WHERE cp."cartId" = ANY($1)
          AND cp."productId" = $2
          AND cp."variationId" IS NULL
          AND cp."affiliateProductId" IS NULL
        GROUP BY month
        ORDER BY month ASC
      `;
            const r = await pool.query(q, [cartIds, productId]);
            rows = r.rows;
        }

        if (kind === "variation") {
            const q = `
        SELECT
          to_char(date_trunc('month', cp."createdAt"), 'YYYY-MM') AS month,
          SUM(cp.quantity)::bigint AS quantity
        FROM "cartProducts" cp
        WHERE cp."cartId" = ANY($1)
          AND cp."productId" = $2
          AND cp."variationId" = $3
        GROUP BY month
        ORDER BY month ASC
      `;
            const r = await pool.query(q, [cartIds, productId, variationId]);
            rows = r.rows;
        }

        if (kind === "affiliate") {
            const q = `
        SELECT
          to_char(date_trunc('month', cp."createdAt"), 'YYYY-MM') AS month,
          SUM(cp.quantity)::bigint AS quantity
        FROM "cartProducts" cp
        WHERE cp."cartId" = ANY($1)
          AND cp."affiliateProductId" = $2
        GROUP BY month
        ORDER BY month ASC
      `;
            const r = await pool.query(q, [cartIds, affiliateProductId]);
            rows = r.rows;
        }

        // Always return all 12 months for the requested year, zero-filling gaps
        const monthly = fillMissingMonths(rows, year);
        return NextResponse.json({ monthly }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/product/monthly] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
