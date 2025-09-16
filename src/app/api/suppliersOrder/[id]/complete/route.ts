import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

type RouteParams = { params: { id: string } };

type Row = {
    productId: string;
    country: string;
    quantity: string | number;
    cost: string | number;
};

type Grouped = {
    productId: string;
    quantity: number; // total per product
    cost: Record<string, number>; // { CL: 300001, VE: 301, ... }
};

export function groupByProduct(rows: Row[]): Grouped[] {
    const map = new Map<string, Grouped>();

    for (const r of rows) {
        const pid = r.productId;
        const q = Number(r.quantity ?? 0) || 0;
        const c = Number(r.cost ?? 0) || 0;
        const ct = r.country;

        if (!map.has(pid)) {
            map.set(pid, { productId: pid, quantity: 0, cost: {} });
        }
        const entry = map.get(pid)!;

        // accumulate quantity across all rows for this product
        entry.quantity += q;

        // set/merge country cost (if duplicates per country exist, keep the max)
        entry.cost[ct] = Math.max(entry.cost[ct] ?? -Infinity, c);
    }

    return Array.from(map.values());
}

type CostMap = Record<string, number>;

function overrideMatches(second: CostMap, first: CostMap): CostMap {
    const out = { ...second };
    for (const [k, v] of Object.entries(first)) {
        if (Object.hasOwn(out, k)) out[k] = v; // only replace if key exists in second
    }
    return out;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    const { organizationId, tenantId } = ctx;
    const { id } = await params;

    if (!id) {
        return NextResponse.json({ error: "Missing order id" }, { status: 400 });
    }

    try {
        const body = await req.json().catch(() => ({} as any));

        //Get all products from order
        const supplierCartQuery = `SELECT "supplierCartId" FROM "supplierOrders" WHERE id = $1`
        const supplierCartResult = await pool.query(supplierCartQuery, [id])
        const supplierCartId = supplierCartResult.rows[0].supplierCartId

        const productsQuery = `SELECT * FROM "supplierCartProducts" WHERE "supplierCartId" = $1`
        const productsResult = await pool.query(productsQuery, [supplierCartId])
        const products = productsResult.rows

        const newCosts = groupByProduct(products)

        for (const cos of newCosts) {
            const costQuery = `SELECT cost, "productType" FROM products WHERE id = $1`
            const costResult = await pool.query(costQuery, [cos.productId])
            const cost = costResult.rows[0]

            const newCost = overrideMatches(cost.cost, cos.cost)

            if (cost.productType === "variable") {
                console.log("ACAAAAA")
                const insertCostQuery = `UPDATE "productVariations" SET cost = $1 WHERE "productId" = $2 RETURNING *`
                await pool.query(insertCostQuery, [newCost, cos.productId])

            }
            const insertCostQuery = `UPDATE products SET cost = $1 WHERE id = $2 RETURNING *`
            await pool.query(insertCostQuery, [newCost, cos.productId])
        }

        const update: [] = []

        for (const rec of body.received) {
            const getStockQuery = `SELECT quantity FROM "warehouseStock" WHERE "warehouseId"='${rec.warehouseId}' AND "productId" ='${rec.productId}' AND country ='${rec.country}'`
            const getStockResult = await pool.query(getStockQuery)
            const getStock = getStockResult.rows[0]

            if (getStock === undefined) {
                const wareStockId = uuidv4()
                const insertStockQuery = `INSERT INTO "warehouseStock" (id, "warehouseId", "productId", country, quantity, "organizationId", "tenantId", "createdAt", "updatedAt")
                    VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
                    RETURNING *`
                const insertStockResult = await pool.query(insertStockQuery, [wareStockId, rec.warehouseId, rec.productId, rec.country, rec.received, organizationId, tenantId])
                const getStock = insertStockResult.rows[0]
                update.push(getStock)
            } else {
                const updateStockQuery = `UPDATE "warehouseStock" SET quantity = $1, "updatedAt" = NOW() WHERE "warehouseId" = $2 AND "productId" = $3 AND country = $4 RETURNING *`
                const updatedStockResult = await pool.query(updateStockQuery, [rec.received + getStock.quantity, rec.warehouseId, rec.productId, rec.country])
                const updateStock = updatedStockResult.rows[0]
                update.push(updateStock)
            }

            const receivedQuery = `UPDATE "supplierCartProducts" SET received = $1 , "updatedAt" = NOW() WHERE "supplierCartId" = $2 AND "productId" = $3 AND country = $4 RETURNING *`
            await pool.query(receivedQuery, [rec.received, supplierCartId, rec.productId, rec.country])
        }

        const completeOrderQuery = `UPDATE "supplierOrders" SET status = 'completed', "updatedAt" = NOW() WHERE id = '${id}' RETURNING *`
        const completeOrderResult = await pool.query(completeOrderQuery)
        const completeOrder = completeOrderResult.rows[0]
        return NextResponse.json({ completeOrder }, { status: 200 });
    } catch (error) {
        console.error("PATCH /api/suppliersOrder/[id] error:", error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}