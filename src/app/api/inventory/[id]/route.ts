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

        const countProductQuery = `SELECT ic.country, ic."expectedQuantity", ic."countedQuantity", ic."variationId", ic."isCounted", p.title, p.sku, p.id
            FROM "inventoryCountItems" ic
            JOIN products p ON ic."productId" = p."id"
            WHERE ic."inventoryCountId" = '${inventoryId}'`
        const countProductResult = await pool.query(countProductQuery)
        const countProduct = countProductResult.rows

        for (const product of countProduct) {
            if (product.variationId !== null) {
                const variationQuery = `SELECT sku FROM "productVariations" WHERE id = '${product.variationId}'`
                const variationResult = await pool.query(variationQuery)
                const result = variationResult.rows[0]

                product.sku = result.sku
            }
        }

        return NextResponse.json({ inventory, countProduct }, { status: 201 });
    } catch (error: any) {
        console.error("[GET /api/inventory/[id]] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    try {
        const { id } = await params;
        const body = await req.json();

        const { productId, country, countedQuantity, variationId, discrepancyReason } = body

        let result = ""

        const setClauses = [
            `"countedQuantity" = ${countedQuantity}`,
            `"isCounted" = TRUE`,
        ];

        if (typeof discrepancyReason === "string") {
            setClauses.push(`"discrepancyReason" = '${discrepancyReason}'`);
        }

        if (typeof variationId === "string") {
            const updateCountQuery = `
                UPDATE "inventoryCountItems"
                SET ${setClauses.join(", ")}
                WHERE "inventoryCountId" = '${id}'
                    AND "productId" = '${productId}'
                    AND country = '${country}'
                    AND "variationId" = '${variationId}'
                RETURNING *
                `;
            const updateCountResult = await pool.query(updateCountQuery)
            result = updateCountResult.rows[0]
        } else {
            const updateCountQuery = `
                UPDATE "inventoryCountItems"
                SET ${setClauses.join(", ")}
                WHERE "inventoryCountId" = '${id}'
                    AND "productId" = '${productId}'
                    AND country = '${country}'
                RETURNING *
                `;
            const updateCountResult = await pool.query(updateCountQuery)
            result = updateCountResult.rows[0]
        }

        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }


}
