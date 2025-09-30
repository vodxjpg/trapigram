// src/app/api/suppliersCart/product/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    console.log("GET /api/suppliersCart/product/:id")
    try {
        const { id } = await params;

        /* 1. Load cart + client */
        const cartRes = await pool.query(`SELECT * FROM "supplierCartProducts" WHERE "productId"=$1`, [id]);
        const result = cartRes.rows

        const stockQuery = `SELECT cost FROM products WHERE id = $1`
        const stockResult = await pool.query(stockQuery, [id])
        const stock = stockResult.rows[0]

        return NextResponse.json({ result, stock }, { status: 200 });
    } catch (error: any) {
        console.error("[GET /api/suppliersCart/product/:id]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    console.log('PATCH /api/suppliersCart/product/:id');

    const client = await pool.connect();
    try {
        const { id: productId } = await params;
        const body = await req.json().catch(() => ({}));

        const supplierCartId: string | undefined = body?.supplierCartId;
        // variationId comes from the UI at the top level of the payload
        let variationId: string | null | undefined = body?.variationId ?? null;
        const allocations: Array<{
            warehouseId: string;
            country: string;
            quantity: number;
            unitCost: number;
        }> = Array.isArray(body?.allocations) ? body.allocations : [];

        if (!supplierCartId || !productId) {
            return NextResponse.json(
                { error: 'supplierCartId and productId are required' },
                { status: 400 }
            );
        }

        // Normalize "base" → null, just in case
        if (variationId === 'base') variationId = null;

        await client.query('BEGIN');

        // Delete only existing rows for *this* product + variant
        let delSql =
            'DELETE FROM "supplierCartProducts" WHERE "supplierCartId" = $1 AND "productId" = $2';
        const delArgs: any[] = [supplierCartId, productId];
        if (variationId == null) {
            delSql += ' AND "variationId" IS NULL';
        } else {
            delSql += ' AND "variationId" = $3';
            delArgs.push(variationId);
        }
        await client.query(delSql, delArgs);

        // Insert new rows for non-zero quantities
        const insertSql = `
      INSERT INTO "supplierCartProducts"
        (id, "supplierCartId", "productId", "variationId",
         "warehouseId", quantity, received, cost, country, "createdAt", "updatedAt")
      VALUES
        ($1, $2, $3, $4,
         $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING *;
    `;

        const allProducts: any[] = [];
        for (const a of allocations) {
            const qty = Number(a?.quantity) || 0;
            if (qty <= 0) continue;

            const args = [
                uuidv4(),
                supplierCartId,
                productId,
                variationId,                 // <- body-level variationId (null for base)
                a.warehouseId,
                qty,
                0,                           // received
                Number(a?.unitCost) || 0,
                a.country ?? null,
            ];
            const { rows } = await client.query(insertSql, args);
            allProducts.push(rows[0]);
        }

        await client.query('COMMIT');
        return NextResponse.json({ allProducts }, { status: 200 });
    } catch (error: any) {
        try { await client.query('ROLLBACK'); } catch { }
        console.error('[PATCH /api/suppliersCart/product/:id]', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    } finally {
        client.release();
    }
}

export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    console.log('DELETE /api/suppliersCart/product/:id');
    try {
        const { id: productId } = await params;
        const body = await req.json().catch(() => ({}));
        const supplierCartId: string | undefined = body?.supplierCartId;
        let variationId: string | null | undefined = body?.variationId;

        if (!supplierCartId || !productId) {
            return NextResponse.json(
                { error: 'supplierCartId and productId are required' },
                { status: 400 }
            );
        }

        // Treat "base" as null just in case a caller sends it
        if (variationId === 'base') variationId = null;

        // Base query + params
        let sql =
            'DELETE FROM "supplierCartProducts" WHERE "supplierCartId" = $1 AND "productId" = $2';
        const args: any[] = [supplierCartId, productId];

        // Constrain by variant correctly
        if (variationId == null) {
            // delete only simple/base lines
            sql += ' AND "variationId" IS NULL';
        } else {
            sql += ' AND "variationId" = $3';
            args.push(variationId);
        }

        const res = await pool.query(sql, args);
        if (res.rowCount === 0) {
            return NextResponse.json(
                { error: 'Cart line not found' },
                { status: 404 }
            );
        }

        return NextResponse.json({ deleted: res.rowCount }, { status: 200 });
    } catch (error: any) {
        console.error('[DELETE /api/suppliersCart/product/:id]', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}
