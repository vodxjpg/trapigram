import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
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
            SELECT 
                i.id, 
                i.reference, 
                i."countType", 
                i.countries, 
                i."createdAt", 
                i."isCompleted",
                w.name, 
                u.name AS username, 
                u.email
            FROM "inventoryCount" i
            JOIN warehouse w ON i."warehouseId" = w.id
            JOIN "user" u ON i."userId" = u.id
            WHERE i.id = '${id}' AND i."organizationId" = '${organizationId}'
            `;
        const result = await pool.query(query);
        if (result.rows.length === 0) {
            return NextResponse.json({ error: "Inventory not found" }, { status: 404 });
        }
        const inventory = result.rows[0];
        const inventoryId = inventory.id

        const countProductQuery = `SELECT
            ic.country,
            ic."expectedQuantity",
            ic."countedQuantity",
            ic."variationId",
            ic."discrepancyReason",
            ic."isCounted",

            -- id becomes the variation id if present; always keep the base product id
            COALESCE(ic."variationId", p.id)       AS id,
            p.id                                    AS "productId",

            -- title: product title for simple, or "Product - AttrName Term / AttrName Term" for variations
            CASE
                WHEN ic."variationId" IS NOT NULL THEN
                CONCAT_WS(' - ',
                    p.title,
                    (
                    SELECT string_agg(pa.name || ' ' || pat.name, ' / ' ORDER BY pa.name)
                    FROM jsonb_each_text(COALESCE(pv.attributes, '{}'::jsonb)) kv(attributeId, termId)
                    JOIN "productAttributes"      pa ON pa.id  = kv.attributeId
                    JOIN "productAttributeTerms" pat ON pat.id = kv.termId
                    )
                )
                ELSE
                p.title
            END                                      AS title,

            -- sku: from variation if present, otherwise product
            COALESCE(pv.sku, p.sku)                  AS sku

            FROM "inventoryCountItems" ic
            JOIN products p
            ON p.id = ic."productId"
            LEFT JOIN "productVariations" pv
            ON pv.id = ic."variationId"
            WHERE ic."inventoryCountId" = $1
            ORDER BY p.title, sku;
            `
        const countProductResult = await pool.query(countProductQuery, [inventoryId])
        const countProduct = countProductResult.rows

        /* for (const product of countProduct) {
            if (product.variationId !== null) {
                const variationQuery = `SELECT sku FROM "productVariations" WHERE id = '${product.variationId}'`
                const variationResult = await pool.query(variationQuery)
                const result = variationResult.rows[0]

                product.sku = result.sku
            }
        } */
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
            `"updatedAt" = NOW()`,
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

        const checkInventoryQuery = `SELECT * FROM "inventoryCountItems" WHERE "inventoryCountId" = '${id}' AND "isCounted" = FALSE`
        const checkInventoryResult = await pool.query(checkInventoryQuery)
        const checkInventory = checkInventoryResult.rows.length

        if (checkInventory === 0) {
            const completeInventoryQuery = `UPDATE "inventoryCount" SET "isCounted" = TRUE WHERE id = '${id}'`
            await pool.query(completeInventoryQuery)
        }
        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    try {
        const { id } = await params;
        const deleteInventoryQuery = `DELETE FROM "inventoryCount" WHERE id='${id}' AND "organizationId"='${organizationId}' RETURNING *`
        const deleteInventoryResult = await pool.query(deleteInventoryQuery)
        const result = deleteInventoryResult.rows[0]

        const deleteInventoryCountQuery = `DELETE FROM "inventoryCountItems" WHERE "inventoryCountId"='${id}'`
        await pool.query(deleteInventoryCountQuery)

        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
    }
}