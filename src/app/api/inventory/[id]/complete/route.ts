import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    try {
        const { id } = await params;

        const checkInventoryQuery = `SELECT * FROM "inventoryCountItems" WHERE "inventoryCountId" = '${id}' AND "isCounted" = FALSE`
        const checkInventoryResult = await pool.query(checkInventoryQuery)
        const checkInventory = checkInventoryResult.rows.length

        const resultInventory: [] = []

        if (checkInventory === 0) {
            const completeInventoryQuery = `UPDATE "inventoryCount" SET "isCompleted" = TRUE WHERE id = '${id}'`
            await pool.query(completeInventoryQuery)

            const checkInventoryQuery = `SELECT * FROM "inventoryCountItems" WHERE "inventoryCountId" = '${id}'`
            const checkInventoryResult = await pool.query(checkInventoryQuery)
            const checkInventory = checkInventoryResult.rows

            const warehouseQuery = `SELECT "warehouseId" FROM "inventoryCount" WHERE id='${id}'`
            const warehouseResult = await pool.query(warehouseQuery)
            const warehouseId = warehouseResult.rows[0].warehouseId

            for (const product of checkInventory) {
                if (typeof product.variationId === "string") {
                    const updateStockQuery = `
                            UPDATE "warehouseStock"
                            SET quantity = ${product.countedQuantity}, "updatedAt" = NOW()
                            WHERE "warehouseId" = '${warehouseId}'
                            AND "productId" = '${product.productId}'
                            AND country = '${product.country}'
                            AND "variationId" = '${product.variationId}'
                            RETURNING *`
                    const result = await pool.query(updateStockQuery)
                    resultInventory.push(result.rows[0])
                } else {
                    const updateStockQuery = `
                            UPDATE "warehouseStock"
                            SET quantity = ${product.countedQuantity}, "updatedAt" = NOW()
                            WHERE "warehouseId" = '${warehouseId}'
                            AND "productId" = '${product.productId}'
                            AND country = '${product.country}'
                            RETURNING *`
                    const result = await pool.query(updateStockQuery)
                    resultInventory.push(result.rows[0])
                }
            }
        }
        return NextResponse.json(resultInventory, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}