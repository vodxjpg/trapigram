import { NextRequest, NextResponse } from 'next/server';
import { getContext } from "@/lib/context";
import { pgPool as pool } from "@/lib/db";
import * as XLSX from 'xlsx';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
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
                w.name, 
                u.name AS username, 
                u.email
            FROM "inventoryCount" i
            JOIN warehouse w ON i."warehouseId" = w.id
            JOIN "user" u ON i."userId" = u.id
            WHERE i.id = '${id}' AND i."organizationId" = '${organizationId}'
            `;
        const result = await pool.query(query);
        const ownerData = result.rows

        const ownerRows = ownerData.map(o => ({
            name: o.username,
            email: o.email,
            reference: o.reference,
            countType: o.countType,
            date: o.createdAt
        }))

        const countProductQuery = `SELECT ic.country, ic."expectedQuantity", ic."countedQuantity", ic."variationId", ic."discrepancyReason", ic."isCounted", p.title, p.sku, p.id
            FROM "inventoryCountItems" ic
            JOIN products p ON ic."productId" = p."id"
            WHERE ic."inventoryCountId" = '${id}'
            `;
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

        const rows = countProduct.map(c => ({
            id: c.id,
            title: c.title,
            sku: c.sku,
            country: c.country,
            expectedQuantity: c.expectedQuantity,
            countedQuantity: c.countedQuantity,
            discrepancyReason: c.discrepancyReason,
            isCounted: c.isCounted
        }));

        // Build workbook with TWO sheets: "Information" (ownerRows) + "Inventory" (rows)
        const wb = XLSX.utils.book_new();

        // Sheet 1: Information
        const infoWs = XLSX.utils.json_to_sheet(ownerRows);
        XLSX.utils.book_append_sheet(wb, infoWs, 'Information');

        // Sheet 2: Inventory
        const inventoryWs = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, inventoryWs, 'Inventory');

        const buffer = XLSX.write(wb, {
            type: 'buffer',
            bookType: 'xlsx',
        });

        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type':
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': 'attachment; filename="inventory.xlsx"',
            },
        });
    } catch (err: any) {
        return new Response(
            JSON.stringify({ error: err.message || 'Internal error' }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
    }
}