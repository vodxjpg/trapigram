import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const cartProductSchema = z.object({
    shippingMethod: z.number(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId } = ctx;

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {

        const { id } = await params;
        const body = await req.json();
        const data = cartProductSchema.parse(body); // throws if invalid

        const method = `
        SELECT countries FROM "shippingMethods" 
        WHERE name = '${data.shippingMethod}' AND "organizationId" = '${organizationId}'
        RETURNING *
      `;

        const countryMethod = await pool.query(method);
        const methodCountry = countryMethod.rows[0];

        const cart = `
        SELECT countries FROM carts 
        WHERE id = '${id}'
        RETURNING *
      `;

        const countryCart = await pool.query(cart);
        const cartCountry = countryCart.rows[0];

        if (methodCountry === cartCountry) {
            const insert = `
            UPDATE carts 
            SET "shippingMethod" = $1, "updatedAt" = NOW()
            WHERE id = $2
            RETURNING *
        `;
            const vals = [
                data.shippingMethod,
                id
            ];

            const result = await pool.query(insert, vals);
            return NextResponse.json(result.rows[0], { status: 201 });
        } else {
            //Error 
        }
    } catch (err: any) {
        console.error("[PATCH /api/cart/:id/update-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}