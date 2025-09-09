// src\app\api\suppliersCart\[id]\add-product\route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";


export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const { id: supplierCartId } = await params;
        const body = await req.json()
        const { productId, allocations: products } = body

        /* supplier context */
        const { rows: clientRows } = await pool.query(
            `SELECT * FROM "supplierCart" ca
            JOIN suppliers c ON c.id = ca."supplierId"
            WHERE ca.id = $1 AND ca."organizationId" = $2`,
            [supplierCartId, organizationId],
        );
        if (!clientRows.length)
            return NextResponse.json({ error: "Cart or client not found" }, { status: 404 });

        const allProducts: [] = []
        console.log(products)

        for (const prod of products) {
            const supplierProductId = uuidv4()
            const productQuery = `INSERT INTO "supplierCartProducts"
                    (id, "supplierCartId", "productId", "warehouseId", quantity, cost, country, "createdAt", "updatedAt")
                    VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    RETURNING *`
            const productResult = await pool.query(productQuery, [supplierProductId, supplierCartId, productId, prod.warehouseId, prod.quantity, prod.unitCost, prod.country])
            const result = productResult.rows[0]
            allProducts.push(result)
        }
        return NextResponse.json({ allProducts }, { status: 201 });
    } catch (err: any) {
        console.error("[POST /api/suppliersCart/:id/add-product]", err);
        return NextResponse.json(
            { error: err.message ?? "Internal server error" },
            { status: 500 },
        );
    }
}
