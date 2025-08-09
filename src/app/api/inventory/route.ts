import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { auth } from "@/lib/auth";
import { getContext } from "@/lib/context";

const inventorySchema = z.object({
    reference: z.string().min(1),
    warehouseId: z.string().min(1),
    countType: z.string().min(1),
    countries: z.array(z.string()).min(1),
});

export async function GET(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {

        const inventoryCountQuery = `SELECT ic.id, ic.reference, ic."countType", ic."createdAt" as "startedOn", wh.name FROM "inventoryCount" ic 
        JOIN warehouse wh ON ic."warehouseId" = wh.id 
        WHERE ic."organizationId" = '${organizationId}'
        ORDER BY ic."createdAt" DESC`
        const inventoryCountResult = await pool.query(inventoryCountQuery)
        const inventoryCount = inventoryCountResult.rows
        return NextResponse.json(inventoryCount, { status: 201 });
    } catch (error) {
        console.error("[GET /api/inventory] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(req: NextRequest) {
    const session = await auth.api.getSession({ headers: req.headers });
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const userId = session.user.id
        const body = await req.json();
        const parsedInventory = inventorySchema.parse(body);


        const {
            reference,
            warehouseId,
            countType,
            countries
        } = parsedInventory;

        const inventoryId = uuidv4();

        const insertQuery = `
            INSERT INTO "inventoryCount"(id, "organizationId", "userId", reference, "warehouseId", "countType", "isCompleted", "countries", "createdAt", "updatedAt")
            VALUES($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING *
            `;

        const values = [
            inventoryId,
            organizationId,
            userId,
            reference,
            warehouseId,
            countType,
            false,
            countries
        ];

        const result = await pool.query(insertQuery, values);
        const inventory = result.rows[0];

        const productQuery = `SELECT ws."productId", ws.country, ws.quantity, ws."variationId", p.sku, p.title
            FROM "warehouseStock" ws
            JOIN products p ON ws."productId" = p.id
            WHERE ws."warehouseId" = '${warehouseId}' AND ws."organizationId" = '${organizationId}'`

        const productResult = await pool.query(productQuery)
        const products = productResult.rows

        for (const product of products) {
            const inventoryItemId = uuidv4()

            const insertQuery = `
            INSERT INTO "inventoryCountItems"(id, "inventoryCountId", "productId", country, "expectedQuantity", "variationId", "isCounted", "createdAt", "updatedAt")
            VALUES($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING *
            `;

            const values = [
                inventoryItemId,
                inventoryId,
                product.productId,
                product.country,
                product.quantity,
                product.variationId,
                false,
            ];

            await pool.query(insertQuery, values);
        }

        return NextResponse.json(inventory, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/inventory] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
