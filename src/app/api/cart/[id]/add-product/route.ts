import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const cartProductSchema = z.object({
    productId: z.string(),
    quantity: z.number(),
    unitPrice: z.number(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    /* --- 3.1  Auth (same block as above) ----------------------------------- */
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    const { searchParams } = new URL(req.url);

    const explicitOrgId = searchParams.get("organizationId");
    let organizationId: string;

    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId)
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    } else if (apiKey) {
        const { valid, error } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid) return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        organizationId = explicitOrgId || "";
        if (!organizationId)
            return NextResponse.json({ error: "organizationId is required" }, { status: 400 });
    } else if (internalSecret === INTERNAL_API_SECRET) {
        const s = await auth.api.getSession({ headers: req.headers });
        if (!s) return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        organizationId = explicitOrgId || s.session.activeOrganizationId;
        if (!organizationId)
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
    } else {
        return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    /* --- 3.2  Validate & insert ------------------------------------------- */
    try {
        const { id } = await params;
        const body = await req.json();
        const cartProductId = uuidv4();

        const productCartQuery = `
        SELECT * FROM "cartProducts"
        WHERE "productId" = '${body.productId}' AND "cartId" = '${id}'
      `;

        const resultProductCart = await pool.query(productCartQuery);
        console.log(resultProductCart.rows[0])

        if (resultProductCart.rows.length > 0) {
            const newQuantity = resultProductCart.rows[0].quantity + body.quantity
            const updateProductCart = `
            UPDATE "cartProducts"
            SET quantity = '${newQuantity}'
            WHERE "productId" = '${body.productId}' AND "id" = '${resultProductCart.rows[0].id}'
            `

            const resultUpdateCart = await pool.query(updateProductCart);
            console.log(resultUpdateCart)

            const productQuery = `
        SELECT * FROM products
        WHERE id = '${body.productId}'
      `;

            const resultProduct = await pool.query(productQuery);

            const cartItem = {
                product: resultProduct.rows[0],
                quantity: newQuantity
            }
            console.log(cartItem)
            return NextResponse.json(cartItem, { status: 201 });
        } else {
            const productQuery = `
        SELECT * FROM products
        WHERE id = '${body.productId}'
      `;

            const resultProduct = await pool.query(productQuery);
            body.unitPrice = body.price
            const data = cartProductSchema.parse(body); // throws if invalid        

            const insert = `
        INSERT INTO "cartProducts" (id, "cartId", "productId", quantity, "unitPrice", "createdAt", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,NOW(),NOW())
        RETURNING *
      `;
            const vals = [
                cartProductId,
                id,
                data.productId,
                data.quantity,
                data.unitPrice,
            ];

            await pool.query(insert, vals);

            const cartItem = {
                product: resultProduct.rows[0],
                quantity: data.quantity
            }
            console.log(cartItem)
            return NextResponse.json(cartItem, { status: 201 });
        }


    } catch (err: any) {
        console.error("[POST /api/cart/:id/add-product]", err);
        if (err instanceof z.ZodError)
            return NextResponse.json({ error: err.errors }, { status: 400 });
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}