// app/api/supplierOrder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { searchParams } = new URL(req.url);
        const page = Math.max(parseInt(searchParams.get("page") ?? "1", 10), 1);
        const pageSize = Math.min(
            Math.max(parseInt(searchParams.get("pageSize") ?? "10", 10), 1),
            100
        );
        const q = (searchParams.get("search") ?? "").trim();
        const statusParam = (searchParams.get("status") ?? "").toLowerCase(); // "", "draft", "pending", "completed"

        // Build WHERE + params
        const params: any[] = [organizationId];
        let i = 2;
        let where = `so."organizationId" = $1`;

        if (q) {
            where += ` AND (coalesce(s.name,'') || ' ' || coalesce(so.note,'')) ILIKE $${i}`;
            params.push(`%${q}%`);
            i++;
        }

        if (statusParam === "draft") {
            where += ` AND so.draft = TRUE`;
        } else if (statusParam === "pending" || statusParam === "completed") {
            where += ` AND so.draft = FALSE AND so.status = $${i}`;
            params.push(statusParam);
            i++;
        }

        // Count
        const countSql = `
      SELECT COUNT(*)::int AS cnt
      FROM "supplierOrders" so
      LEFT JOIN "suppliers" s ON s.id = so."supplierId"
      WHERE ${where}
    `;
        const { rows: countRows } = await pool.query(countSql, params);
        const total = countRows?.[0]?.cnt ?? 0;

        // Page
        const dataSql = `
        SELECT
            so.id,
            so."supplierId",
            s.name AS "supplierName",
            so.note,
            so."expectedAt" AS "expectedAt",
            so.status,
            so.draft,
            so."createdAt" AS "createdAt"
        FROM "supplierOrders" so
        LEFT JOIN "suppliers" s ON s.id = so."supplierId"
        WHERE ${where}
        ORDER BY so."createdAt" DESC
        LIMIT $${i} OFFSET $${i + 1}
        `;
        const dataParams = [...params, pageSize, (page - 1) * pageSize];
        const { rows } = await pool.query(dataSql, dataParams);

        const items = rows.map((r: any) => ({
            id: r.id,
            supplier: r.supplierId ? { id: r.supplierId, name: r.supplierName ?? null } : null,
            note: r.note ?? null,
            expectedAt: r.expectedAt ?? null,
            status: r.draft ? "draft" : r.status, // normalize for UI
            createdAt: r.createdAt,
        }));

        return NextResponse.json(
            {
                items,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
            },
            { status: 200 }
        );
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}


export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    try {
        const body = await req.json()
        const { supplierId, supplierCartId, note, expectedAt, draft } = body

        await pool.query(`UPDATE "supplierCart" SET status = FALSE WHERE id='${supplierCartId}'`)

        const id = uuidv4()
        const status = "pending"
        const insert = await pool.query(
            `INSERT INTO "supplierOrders" (id, "supplierId", "organizationId", "supplierCartId", note, status, draft, "expectedAt", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *`,
            [id, supplierId, organizationId, supplierCartId, note, status, draft, expectedAt]
        );
        return NextResponse.json({ supplier: insert.rows[0] }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
