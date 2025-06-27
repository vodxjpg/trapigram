import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing

interface Entry {
    title: string
    sku: string
    quantity: number
    date: string  // ISO timestamp
}

interface MonthSummary {
    month: string   // "YYYY-MM"
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
function summarizeByMonthOfYear(
    entries: Entry[],
    year: number
): MonthSummary[] {
    // 1) Build a map: YYYY-MM → accumulated quantity + carry first title/sku
    const map: Record<string, MonthSummary> = {}
    for (const { title, sku, quantity, date } of entries) {
        const d = new Date(date)
        const y = d.getFullYear()
        if (y !== year) continue     // ignore other years
        const m = String(d.getMonth() + 1).padStart(2, "0")
        const key = `${y}-${m}`
        if (!map[key]) {
            map[key] = { month: key, title, sku, quantity: 0 }
        }
        map[key].quantity += quantity
    }

    // 2) Build the full Jan–Dec array for that year
    const result: MonthSummary[] = []
    for (let mo = 1; mo <= 12; mo++) {
        const mm = String(mo).padStart(2, "0")
        const key = `${year}-${mm}`
        if (map[key]) {
            result.push(map[key])
        } else {
            // zero‐quantity placeholder
            // if you want to carry a default title/sku, pick from entries[0] or pass in defaults
            const def = entries[0] || { title: "", sku: "" }
            result.push({
                month: key,
                title: def.title,
                sku: def.sku,
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
        const year = searchParams.get('year')

        const queryData = `SELECT title, sku FROM products WHERE id = '${id}'`
        const resultData = await pool.query(queryData);
        const { title, sku } = resultData.rows[0]

        const monthlyQueryCarts = `SELECT "cartId" FROM orders WHERE "organizationId" = '${organizationId}' AND status = 'completed' AND EXTRACT(YEAR FROM "createdAt") = ${year}`
        const monthlyResultCarts = await pool.query(monthlyQueryCarts);
        const carts = monthlyResultCarts.rows

        const monthlyArray: {
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
                monthlyArray.push({
                    title: rows[0].title,
                    sku: rows[0].sku,
                    quantity: rows[0].quantity,
                    date: rows[0].createdAt,
                })
            }
        }

        const monthly = summarizeByMonthOfYear(monthlyArray, Number(year))

        return NextResponse.json({ title, sku, monthly }, { status: 200 });
    } catch (err) {
        console.error("[GET /api/report/product/:id]", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}