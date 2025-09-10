// app/api/supplierOrder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import type { PoolClient } from "pg";

/** Get next per-org orderKey safely within a transaction */
async function getNextOrderKeyTx(client: PoolClient, organizationId: string): Promise<number> {
    // Lock scoped to this org to avoid races from concurrent requests
    await client.query(
        `SELECT pg_advisory_xact_lock(hashtext($1))`,
        [`supplierOrders:${organizationId}`]
    );

    const { rows } = await client.query<{ next: number }>(
        `SELECT COALESCE(MAX("orderKey"), 0) + 1 AS next
     FROM "supplierOrders"
     WHERE "organizationId" = $1`,
        [organizationId]
    );
    return Number(rows[0]?.next ?? 1);
}

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
            so."orderKey",
            so."expectedAt" AS "expectedAt",
            so.status,
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
            orderKey: r.orderKey,
            supplier: r.supplierId ? { id: r.supplierId, name: r.supplierName ?? null } : null,
            note: r.note ?? null,
            expectedAt: r.expectedAt ?? null,
            status: r.status, // normalize for UI
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
    const client = await pool.connect();
    try {
        const body = await req.json()
        const { supplierId, supplierCartId, note, expectedAt, submitAction } = body

        await pool.query(`UPDATE "supplierCart" SET status = FALSE WHERE id='${supplierCartId}'`)

        // Generate next orderKey (per organization) safely
        const orderKey = await getNextOrderKeyTx(client, organizationId);

        const id = uuidv4()
        const status = submitAction === "place_order" ? "pending" : "draft"
        const insert = await pool.query(
            `INSERT INTO "supplierOrders" (id, "supplierId", "organizationId", "supplierCartId", note, status, "orderKey", "expectedAt", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *`,
            [id, supplierId, organizationId, supplierCartId, note, status, orderKey, expectedAt]
        );
        return NextResponse.json({ supplier: insert.rows[0] }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
