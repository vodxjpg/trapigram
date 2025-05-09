import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const cartSchema = z.object({
    clientId: z.string().min(1, { message: "Name is required." }),
});

export async function POST(req: NextRequest) {
    const apiKey = req.headers.get("x-api-key");
    const internalSecret = req.headers.get("x-internal-secret");
    let organizationId: string;

    const { searchParams } = new URL(req.url);
    const explicitOrgId = searchParams.get("organizationId");

    // Case 1: Check for session (UI requests)
    const session = await auth.api.getSession({ headers: req.headers });
    if (session) {
        organizationId = explicitOrgId || session.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    }
    // Case 2: External API request with API key
    else if (apiKey) {
        const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
        if (!valid || !key) {
            return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
        }
        organizationId = explicitOrgId || "";
        if (!organizationId) {
            return NextResponse.json({ error: "Organization ID is required in query parameters" }, { status: 400 });
        }
    }
    // Case 3: Internal request with secret
    else if (internalSecret === INTERNAL_API_SECRET) {
        const internalSession = await auth.api.getSession({ headers: req.headers });
        if (!internalSession) {
            return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
        }
        organizationId = explicitOrgId || internalSession.session.activeOrganizationId;
        if (!organizationId) {
            return NextResponse.json({ error: "No active organization in session" }, { status: 400 });
        }
    } else {
        return NextResponse.json({ error: "Unauthorized: Provide a valid session, API key, or internal secret" }, { status: 403 });
    }

    try {
        const body = await req.json();
        const parsedCart = cartSchema.parse(body);

        const {
            clientId,
        } = parsedCart;

        const activeCart = `
        SELECT * FROM carts
        WHERE "clientId" = '${clientId}' AND status = true
        `

        const resultCart = await pool.query(activeCart);
        const cart = resultCart.rows[0];

        if (cart) {
            const cartProducts = `SELECT 
                    p.id,
                    p.title,
                    p.description,
                    p.image,
                    p.sku,
                    cp.quantity,
                    cp."unitPrice"
                    FROM products AS p
                    INNER JOIN "cartProducts" AS cp
                    ON p.id = cp."productId"
                    WHERE cp."cartId" = '${cart.id}';
                  `

            const resultCartProducts = await pool.query(cartProducts);
            return NextResponse.json({ newCart: cart, resultCartProducts }, { status: 201 });
        }

        if (!cart) {
            // case: no items in the cart
            const clientQuery = `
            SELECT * FROM clients
            WHERE id = '${clientId}'
          `;

            const resultClient = await pool.query(clientQuery);
            const country = resultClient.rows[0].country
            const status = true

            const cartId = uuidv4();

            const insertQuery = `
            INSERT INTO carts(id, "clientId", country, status, "createdAt", "updatedAt")
            VALUES($1, $2, $3, $4, NOW(), NOW())
            RETURNING *
          `;
            const values = [
                cartId,
                clientId,
                country,
                status
            ];

            const result = await pool.query(insertQuery, values);
            const newCart = result.rows[0];
            const resultCartProducts: string[] = []

            return NextResponse.json({ newCart, resultCartProducts }, { status: 201 });
        }

    } catch (error: any) {
        console.error("[POST /api/cart] error:", error);
        if (error instanceof z.ZodError) {
            return NextResponse.json({ error: error.errors }, { status: 400 });
        }
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}