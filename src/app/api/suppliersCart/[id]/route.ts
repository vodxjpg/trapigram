// src/app/api/suppliersCart/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

type Row = {
    lineId: string;            // cp.id (raw line id; useful for debugging)
    productId: string;         // p.id (parent product)
    variationId: string | null;
    title: string;
    description: string;
    image: string | null;
    sku: string;
    quantity: string | number;
    received: string | number;
    unitCost: string | number;
    createdAt: Date;
};

/**
 * Group by (productId, variationId) so each variant stays separate.
 * Emit a stable composite `id` used by the frontend as the line key.
 */
function groupSumByVariant(rows: Row[]) {
    const byKey = new Map<string, any>();
    for (const r of rows) {
        const key = `${r.productId}:${r.variationId ?? "base"}`;
        const qty = Number(r.quantity) || 0;
        const rec = Number(r.received) || 0;
        if (!byKey.has(key)) {
            byKey.set(key, {
                id: key, // ← IMPORTANT: unique per (productId, variationId)
                productId: r.productId,
                variationId: r.variationId ?? null,
                title: r.title,
                description: r.description,
                image: r.image,
                sku: r.sku,
                quantity: qty,
                received: rec,
                unitCost: Number(r.unitCost ?? 0) || 0,
                createdAt: r.createdAt,
            });
        } else {
            const cur = byKey.get(key)!;
            cur.quantity += qty;
            cur.received += rec;
            // keep earliest createdAt, prefer first non-null image
            if (!cur.image && r.image) cur.image = r.image;
        }
    }
    return Array.from(byKey.values());
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    console.log("/api/suppliersCart/:id")
    try {
        const { id } = await params;

        /* 1. Load cart + client */
        const cartRes = await pool.query(`SELECT * FROM "supplierCart" WHERE id=$1`, [id]);
        if (!cartRes.rowCount)
            return NextResponse.json({ error: "Cart not found" }, { status: 404 });

        const prodQ = `
          SELECT
            cp.id                AS "lineId",
            p.id                 AS "productId",
            p.title,
            p.description,
            p.image,
            p.sku,
            cp.quantity,
            cp.received,
            cp."warehouseId",
            cp.cost              AS "unitCost",
            cp.country,
            cp."variationId",
            cp."createdAt"
          FROM products p
          JOIN "supplierCartProducts" cp ON p.id = cp."productId"
          WHERE cp."supplierCartId" = $1
          ORDER BY cp."createdAt" ASC
        `;
        const prodQResult = await pool.query(prodQ, [id]);
        const result: Row[] = prodQResult.rows;

        const rows = groupSumByVariant(result)
        console.log(rows)
        /* 4. Return both legacy and new keys */
        return NextResponse.json(
            {
                resultCartProducts: rows,
                result,    // caller can inspect this
            },
            { status: 200 },
        );
    } catch (error: any) {
        console.error("[GET /api/suppliersCart/:id]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}