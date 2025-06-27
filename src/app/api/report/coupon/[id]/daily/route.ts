import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import { getYear, getMonth } from "date-fns"

// nothing

interface Entry {
    couponCode: string;
    date: string;   // ISO timestamp
}

interface DayCount {
    day: number;        // 1–31
    quantity: number;   // count of entries that day
}

function dailyCountsForMonthUTC(
    entries: Entry[],
    year: number,
    monthIndex: number
): DayCount[] {
    // 1) Determine how many days are in this month
    const daysInMonth = new Date(
        Date.UTC(year, monthIndex + 1, 0)
    ).getUTCDate()

    // 2) Tally entries on each UTC day
    const counts: Record<number, number> = {}
    for (const { date } of entries) {
        const d = new Date(date)
        if (d.getUTCFullYear() !== year) continue
        if (d.getUTCMonth() !== monthIndex) continue
        const day = d.getUTCDate()         // 1–31 in UTC
        counts[day] = (counts[day] || 0) + 1
    }

    // 3) Build full array, but now with `date: "YYYY-MM-DD"` keys
    const yy = String(year)
    const mm = String(monthIndex + 1).padStart(2, "0")
    return Array.from({ length: daysInMonth }, (_, i) => {
        const dd = String(i + 1).padStart(2, "0")
        return {
            date: `${yy}-${mm}-${dd}`,
            redemptions: counts[i + 1] || 0
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
        const from = searchParams.get('from')
        const to = searchParams.get('to')
        const date = new Date(to)
        const month = getMonth(date)
        const year = getYear(date)

        const queryData = `SELECT code FROM coupons WHERE id = '${id}'`
        const resultData = await pool.query(queryData);
        const { code } = resultData.rows[0]

        const dailyQueryCarts = `SELECT * FROM orders WHERE "organizationId" = '${organizationId}' AND "couponCode"= '${code}' AND status = 'completed' AND "createdAt" BETWEEN '${from}' AND '${to}'`
        const dailyResultCarts = await pool.query(dailyQueryCarts);
        const coupons = dailyResultCarts.rows

        const dailyArray: {
            couponCode: string
            date: string
        }[] = []

        for (const cp of coupons) {
            dailyArray.push({
                couponCode: code,
                date: cp.createdAt,
            })
        }

        const daily = dailyCountsForMonthUTC(dailyArray, year, month);

        return NextResponse.json({ code, daily }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/coupon/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}