import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {
        const { id } = await params;

        const insert = `
        DELETE FROM "cartProducts" 
        WHERE "cartId" = $1 
        RETURNING *
      `;
        const vals = [
            id,
        ];

        const result = await pool.query(insert, vals);
        return NextResponse.json(result.rows[0], { status: 201 });
    } catch (err: any) {
        console.error("[DELETE /api/cart/:id/clear]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}