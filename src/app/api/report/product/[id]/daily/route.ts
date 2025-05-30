import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { getYear, getMonth } from "date-fns"

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

interface Row {
    title: string
    sku: string
    quantity: number
    date: string   // full ISO timestamp
}

interface DayGroup {
    date: string   // "YYYY-MM-DD"
    title: string
    sku: string
    quantity: number
}

/**
 * Groups rows by day of the given month, ensuring every day appears.
 *
 * @param rows        your flat array of { title, sku, quantity, date }
 * @param defaultRow  a template for empty days (e.g. { title, sku })
 * @param year        4-digit year, defaults to current year
 * @param monthIndex  0-based month (0=Jan…11=Dec), defaults to current month
 */
function groupByDayWithZeros(
    rows: Row[],
    defaultRow: Pick<Row, "title" | "sku">,
    year = new Date().getFullYear(),
    monthIndex = new Date().getMonth()
): DayGroup[] {
    // 1) Build a map of YYYY-MM-DD → accumulated DayGroup
    const map: Record<string, DayGroup> = {}

    for (const { date, title, sku, quantity } of rows) {
        const dayKey = new Date(date).toISOString().slice(0, 10) // "YYYY-MM-DD"
        if (!map[dayKey]) {
            map[dayKey] = { date: dayKey, title, sku, quantity: 0 }
        }
        map[dayKey].quantity += quantity
    }

    // 2) Figure out how many days in that month
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()

    // 3) Build the full array, filling zeros for missing days
    const result: DayGroup[] = []
    const mm = String(monthIndex + 1).padStart(2, "0")

    for (let d = 1; d <= daysInMonth; d++) {
        const dd = String(d).padStart(2, "0")
        const key = `${year}-${mm}-${dd}`
        if (map[key]) {
            result.push(map[key])
        } else {
            result.push({
                date: key,
                title: defaultRow.title,
                sku: defaultRow.sku,
                quantity: 0,
            })
        }
    }

    return result
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
        const year = getYear(date)
        const month = getMonth(date)

        const queryData = `SELECT title, sku FROM products WHERE id = '${id}'`
        const resultData = await pool.query(queryData);
        const { title, sku } = resultData.rows[0]

        const dailyQueryCarts = `SELECT "cartId" FROM orders WHERE "organizationId" = '${organizationId}' AND status = 'completed' AND "createdAt" BETWEEN '${from}' AND '${to}'`
        const dailyResultCarts = await pool.query(dailyQueryCarts);
        const carts = dailyResultCarts.rows

        const dailyArray: {
            title: string
            sku: string
            quantity: number
            date: string
        }[] = []

        for (const ct of carts) {
            const queryCalc = `
                SELECT cp.quantity,
                    cp."createdAt",
                    p.title,
                    p.sku
                FROM "cartProducts" cp
                JOIN products p
                    ON p.id = cp."productId"
                WHERE cp."cartId"   = $1
                AND cp."productId" = $2
            `
            const { rows } = await pool.query(queryCalc, [ct.cartId, id])
            if (rows.length > 0) {
                dailyArray.push({
                    title: rows[0].title,
                    sku: rows[0].sku,
                    quantity: rows[0].quantity,
                    date: rows[0].createdAt,
                })
            }
        }

        const daily = groupByDayWithZeros(
            dailyArray,
            { title: title, sku: sku },
            year,
            month  // May
        )

        return NextResponse.json({ title, sku, daily }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/product/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}