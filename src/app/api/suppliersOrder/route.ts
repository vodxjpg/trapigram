// app/api/supplierOrder/route.ts
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";

export async function POST(req: NextRequest) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;
    try {
        const body = await req.json()
        const { supplierId, supplierCartId, note, expectedAt } = body

        await pool.query(`UPDATE "supplierCart" SET status = FALSE WHERE id='${supplierCartId}'`)

        const id = uuidv4()
        const status = "pending"
        const insert = await pool.query(
            `INSERT INTO "supplierOrders" (id, "supplierId", "organizationId", "supplierCartId", note, status, "expectedAt", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
            RETURNING *`,
            [id, supplierId, organizationId, supplierCartId, note, status, expectedAt]
        );
        return NextResponse.json({ supplier: insert.rows[0] }, { status: 201 });
    } catch (error) {
        console.error(error);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
