import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";

// nothing
// Updated coupon update schema with new field "expendingMinimum"

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    try {
        const { id } = await params;
        const query = `
            SELECT i.id, i.reference, i."countType", i.countries, i."createdAt", w.name
            FROM "inventoryCount" i
            JOIN warehouse w
            ON i."warehouseId" = w.id
            WHERE i.id = '${id}' AND i."organizationId" = '${organizationId}'
            `;
        const result = await pool.query(query);
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Inventory not found" }, { status: 404 });
        }
        const inventory = result.rows[0];
        const inventoryId = inventory.id

        const countProductQuery = `SELECT ic.country, ic."expectedQuantity", p.title, p.sku  
            FROM "inventoryCountItems" ic
            JOIN products p ON ic."productId" = p."id"
            WHERE ic."inventoryCountId" = '${inventoryId}'`
        const countProductResult = await pool.query(countProductQuery)
        const countProduct = countProductResult.rows
        console.log(countProduct)

        return NextResponse.json({ inventory, countProduct }, { status: 201 });
    } catch (error: any) {
        console.error("[GET /api/inventory/[id]] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

