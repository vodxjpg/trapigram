import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing

interface Entry {
    couponCode: string;
    date: string;   // ISO timestamp
}

interface MonthCount {
    month: string;       // "YYYY-MM"
    couponCode: string;
    redemptions: number; // count in that month
}

function monthlyRedemptions(
    entries: Entry[],
    year: number,
    monthIndices: number[]
): MonthCount[] {
    // 1) Tally counts per monthIndex
    const counts: Record<number, number> = {}
    for (const { couponCode, date } of entries) {
        const d = new Date(date)
        if (d.getUTCFullYear() !== year) continue
        const mi = d.getUTCMonth()  // 0–11
        counts[mi] = (counts[mi] || 0) + 1
    }

    // 2) Build one entry per requested monthIndex
    return monthIndices.map((mi) => {
        const mm = String(mi + 1).padStart(2, "0")
        return {
            month: `${year}-${mm}`,
            couponCode: entries[0]?.couponCode ?? "",
            redemptions: counts[mi] || 0
        }
    })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { id } = await params;
        const { searchParams } = new URL(req.url)
        const year = searchParams.get('year')

        const queryData = `SELECT code FROM coupons WHERE id = '${id}'`
        const resultData = await pool.query(queryData);
        const { code } = resultData.rows[0]

        const dailyQueryCarts = `SELECT * FROM orders WHERE "organizationId" = '${organizationId}' AND "couponCode"= '${code}' AND status = 'completed' AND EXTRACT(YEAR FROM "createdAt") = ${year}`
        const dailyResultCarts = await pool.query(dailyQueryCarts);
        const coupons = dailyResultCarts.rows

        const monthlyArray: {
            couponCode: string
            date: string
        }[] = []

        for (const cp of coupons) {
            monthlyArray.push({
                couponCode: code,
                date: cp.createdAt,
            })
        }

        const monthly = monthlyRedemptions(monthlyArray, Number(year), Array.from({ length: 12 }, (_, i) => i))

        return NextResponse.json({ code, monthly }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/coupon/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}