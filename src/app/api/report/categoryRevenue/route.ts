// app/api/report/revenue/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing

export async function GET(req: NextRequest) {
    const url = new URL(req.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const currency = url.searchParams.get("currency")

    if (!from || !to) {
        return NextResponse.json(
            { error: "Missing required query parameters `from` and `to`." },
            { status: 400 }
        );
    }

    const ctx = await getContext(req);
    /* if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx; */
    const organizationId = "W0duzyHA23ezm9Mcvso1y32KPko4XjRn"

    try {
        const revenueQuery = `SELECT
            cr."${currency}total" AS total, cr."${currency}cost" AS cost, cr."createdAt" AS date,
            pc.name AS category
            FROM
            "categoryRevenue" AS cr
            JOIN "productCategories" AS pc
            ON cr."categoryId" = pc.id
            WHERE cr."organizationId" = $1 AND cr."createdAt" BETWEEN $2::timestamptz AND $3::timestamptz
            ORDER BY cr."createdAt" DESC
            `;

        const values = [organizationId, from, to];

        const result = await pool.query(revenueQuery, values);
        const row = result.rows

        for (const ct of row) {
            ct.revenue = (ct.total - ct.cost).toFixed(2)
        }

        const groupedCategory = Object.values(
            row.reduce((acc, { category, total, cost, revenue }) => {
                // ensure we have a bucket for this category
                if (!acc[category]) {
                    acc[category] = { category, total: 0, cost: 0, revenue: 0 };
                }
                // add up (converting from string)
                acc[category].total += parseFloat(total);
                acc[category].cost += parseFloat(cost);
                acc[category].revenue += parseFloat(revenue);
                return acc;
            }, /** @type { Record<string, { category: string; total: number; cost: number }> } */({}))
        );

        return NextResponse.json({ categories: groupedCategory }, { status: 200 });
    } catch (err) {
        console.error("Error fetching revenue:", err);
        return NextResponse.json(
            { error: "Internal server error." },
            { status: 500 }
        );
    }
}
