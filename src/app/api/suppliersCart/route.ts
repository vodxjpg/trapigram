// src/app/api/suppliersCart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";

export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    try {
        const body = await req.json();
        const { supplierId } = body

        // See if there's an existing active cart
        const activeCartQ = `
        SELECT * FROM "supplierCart"
        WHERE "supplierId" = $1 AND status = true
        `;
        const resultCart = await pool.query(activeCartQ, [supplierId]);
        const cart = resultCart.rows[0];

        if (cart) {
            return NextResponse.json({ newCart: cart }, { status: 201 });
        }

        const supplierCartId = uuidv4();
        const status = true;

        const insertQ = `INSERT INTO "supplierCart" 
            (id, "supplierId", "organizationId",
            status, "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, NOW(), NOW())
            RETURNING *`;

        const values = [
            supplierCartId,
            supplierId,
            organizationId,
            status,
        ];

        const result = await pool.query(insertQ, values);
        const newCart = result.rows[0];

        return NextResponse.json({ newCart }, { status: 201 });
    } catch (error: any) {
        console.error("[POST /api/supplierCart] error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}