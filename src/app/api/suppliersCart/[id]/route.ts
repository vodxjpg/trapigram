// src/app/api/suppliersCart/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

type Row = {
    id: string;
    title: string;
    description: string;
    image: string | null;
    sku: string;
    quantity: string | number;
    createdAt: Date;
};

function groupSumById(rows: Row[]) {
    const byId = new Map<string, Row & { quantity: number }>();

    for (const r of rows) {
        const qty = Number(r.quantity) || 0; // quantity arrives as string → coerce
        if (!byId.has(r.id)) {
            // keep the first row’s metadata; quantity as number
            byId.set(r.id, { ...r, quantity: qty });
        } else {
            const cur = byId.get(r.id)!;
            cur.quantity += qty;
            // optional: decide which createdAt to keep (earliest, latest, etc.)
            // cur.createdAt = cur.createdAt < r.createdAt ? cur.createdAt : r.createdAt;
        }
    }

    return Array.from(byId.values());
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
            p.id, p.title, p.description, p.image, p.sku,
            cp.quantity, cp.received, cp."warehouseId", cp.cost, cp.country,
            cp."createdAt"                     /* NEW */
            FROM products p
            JOIN "supplierCartProducts" cp ON p.id = cp."productId"
            WHERE cp."supplierCartId" = $1
        `;
        const prodQResult = await pool.query(prodQ, [id])
        const result = prodQResult.rows

        const rows = groupSumById(result)
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