// src/app/api/report/products/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

type ReportRow = {
    kind: "product" | "variation" | "affiliate";
    productId?: string | null;
    variationId?: string | null;
    affiliateProductId?: string | null;
    title: string | null;
    sku: string | null;
    quantity: number;
};

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { organizationId } = ctx;

    try {
        const { searchParams } = new URL(req.url);
        const from = searchParams.get("from"); // YYYY-MM-DD
        const to = searchParams.get("to");     // YYYY-MM-DD
        if (!from || !to) {
            return NextResponse.json(
                { error: "Missing 'from' or 'to' query param (YYYY-MM-DD)" },
                { status: 400 }
            );
        }

        // 1) Get all carts in the date range (include the entire 'to' day)
        const statuses = ["completed", "paid", "pending_payment"];
        const cartsRes = await pool.query(
            `
            SELECT "cartId"
            FROM orders
            WHERE "organizationId" = $1
                AND status = ANY($2)
                AND "createdAt" >= ($3::date)
                AND "createdAt" <  (($4::date + INTERVAL '1 day'))
            `,
            [organizationId, statuses, from, to]
        );

        const cartIds: string[] = cartsRes.rows.map((r: any) => r.cartId).filter(Boolean);
        if (cartIds.length === 0) {
            const empty: ReportRow[] = [];
            return NextResponse.json({ stats: empty, values: { stats: empty } }, { status: 200 });
        }

        // 2) Aggregate quantities and join product/variation/affiliate metadata.
        //    Build the variant label from JSON attributes via LATERAL join.
        const reportRes = await pool.query(
            `
      SELECT
        cp."productId",
        cp."variationId",
        cp."affiliateProductId",
        SUM(cp.quantity)::bigint AS qty,

        -- product
        p.title        AS product_title,
        p.sku          AS product_sku,

        -- variation
        pv.sku         AS variation_sku,
        CASE
          WHEN lbl.attr_label IS NULL OR lbl.attr_label = '' THEN p.title
          ELSE p.title || ' - ' || lbl.attr_label
        END            AS variation_title,

        -- affiliate
        ap.title       AS affiliate_title,
        ap.sku         AS affiliate_sku
      FROM "cartProducts" cp
      LEFT JOIN products p
        ON cp."productId" = p.id
      LEFT JOIN "productVariations" pv
        ON cp."variationId" = pv.id
      LEFT JOIN LATERAL (
        SELECT string_agg(a.name || ' ' || t.name, ' - ' ORDER BY a.name) AS attr_label
        FROM jsonb_each_text(COALESCE(pv.attributes::jsonb, '{}'::jsonb)) kv(k, v)
        JOIN "productAttributes"     a ON a.id::text = kv.k   -- if UUID, use a.id = (kv.k)::uuid
        JOIN "productAttributeTerms" t ON t.id::text = kv.v   -- if UUID, use t.id = (kv.v)::uuid
      ) AS lbl ON TRUE
      LEFT JOIN "affiliateProducts" ap
        ON cp."affiliateProductId" = ap.id
      WHERE cp."cartId" = ANY($1)
      GROUP BY
        cp."productId",
        cp."variationId",
        cp."affiliateProductId",
        p.title, p.sku,
        pv.sku,
        ap.title, ap.sku,
        lbl.attr_label
      ORDER BY qty DESC NULLS LAST
      `,
            [cartIds]
        );

        const stats: ReportRow[] = reportRes.rows.map((r: any) => {
            const productId: string | null = r.productid ?? r.productId ?? null;
            const variationId: string | null = r.variationid ?? r.variationId ?? null;
            const affiliateProductId: string | null = r.affiliateproductid ?? r.affiliateProductId ?? null;

            // affiliate-only item
            if (affiliateProductId) {
                return {
                    kind: "affiliate",
                    affiliateProductId,
                    title: r.affiliate_title ?? null,
                    sku: r.affiliate_sku ?? null,
                    quantity: Number(r.qty) || 0,
                };
            }

            // product variation
            if (variationId) {
                return {
                    kind: "variation",
                    productId,
                    variationId,
                    title: r.variation_title ?? r.product_title ?? null,
                    sku: r.variation_sku ?? r.product_sku ?? null,
                    quantity: Number(r.qty) || 0,
                };
            }

            // simple product
            return {
                kind: "product",
                productId,
                title: r.product_title ?? null,
                sku: r.product_sku ?? null,
                quantity: Number(r.qty) || 0,
            };
        });
        console.log(stats)

        return NextResponse.json({ stats, values: { stats } }, { status: 200 });
    } catch (err: any) {
        console.error("[GET /api/report/products] error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
