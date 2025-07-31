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
    const session = await auth();
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page")) || 1;
    const pageSize = Number(searchParams.get("pageSize")) || 10;
    const search = searchParams.get("search") || "";

    let countQuery = `
    SELECT COUNT(*) FROM coupons
    WHERE "organizationId" = $1
  `;
    const countValues: any[] = [organizationId];
    if (search) {
        countQuery += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
        countValues.push(`%${search}%`);
    }

    // Updated SELECT query to include "expendingMinimum"
    let query = `
    SELECT id, "organizationId", name, code, description, "discountType", "discountAmount", "startDate", "expirationDate", 
      "limitPerUser", "usageLimit","usagePerUser", "expendingLimit", "expendingMinimum", countries, visibility, "createdAt", "updatedAt"
    FROM coupons
    WHERE "organizationId" = $1
  `;
    const values: any[] = [organizationId];
    if (search) {
        query += ` AND (name ILIKE $2 OR code ILIKE $2 OR description ILIKE $2)`;
        values.push(`%${search}%`);
    }
    query += ` ORDER BY "createdAt" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`;
    values.push(pageSize, (page - 1) * pageSize);

    try {
        const countResult = await pool.query(countQuery, countValues);
        const totalRows = Number(countResult.rows[0].count);
        const totalPages = Math.ceil(totalRows / pageSize);

        const result = await pool.query(query, values);
        const coupons = result.rows;
        coupons.forEach((coupon) => {
            coupon.countries = JSON.parse(coupon.countries);
        });

        return NextResponse.json({
            coupons,
            totalPages,
            currentPage: page,
        });
    } catch (error: any) {
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
