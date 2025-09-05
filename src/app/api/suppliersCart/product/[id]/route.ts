// src/app/api/suppliersCart/product/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
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

        return NextResponse.json({ result }, { status: 200 });
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
    console.log("PATCH /api/suppliersCart/product/:id")
    try {
        const { id } = await params;
        const body = await req.json()
        const { supplierCartId, allocations: products } = body

        const emptyOrderQuery = `DELETE FROM "supplierCartProducts" WHERE "supplierCartId" = $1 AND "productId"=$2`
        await pool.query(emptyOrderQuery, [supplierCartId, id])

        const allProducts: [] = []

        for (const prod of products) {
            if (prod.quantity > 0) {
                const supplierProductId = uuidv4()
                const productQuery = `INSERT INTO "supplierCartProducts"
                    (id, "supplierCartId", "productId", "warehouseId", quantity, cost, country, "createdAt", "updatedAt")
                    VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    RETURNING *`
                const productResult = await pool.query(productQuery, [supplierProductId, supplierCartId, id, prod.warehouseId, prod.quantity, prod.unitCost, prod.country])
                const result = productResult.rows[0]
                allProducts.push(result)
            }
        }

        return NextResponse.json({ allProducts }, { status: 200 });
    } catch (error: any) {
        console.error("[PATCH /api/suppliersCart/product/:id]", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}