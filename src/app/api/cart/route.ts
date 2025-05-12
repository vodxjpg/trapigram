// src/app/api/cart/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { auth } from "@/lib/auth";
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET as string;

const cartSchema = z.object({
  clientId: z.string().min(1, { message: "Name is required." }),
});

export async function POST(req: NextRequest) {
  // --- auth boilerplate ---
  const apiKey = req.headers.get("x-api-key");
  const internalSecret = req.headers.get("x-internal-secret");
  let organizationId: string;

  const { searchParams } = new URL(req.url);
  const explicitOrgId = searchParams.get("organizationId");

  const session = await auth.api.getSession({ headers: req.headers });
  if (session) {
    organizationId = explicitOrgId || session.session.activeOrganizationId!;
  } else if (apiKey) {
    const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
    if (!valid || !key) {
      return NextResponse.json({ error: error?.message || "Invalid API key" }, { status: 401 });
    }
    organizationId = explicitOrgId || "";
  } else if (internalSecret === INTERNAL_API_SECRET) {
    const internalSession = await auth.api.getSession({ headers: req.headers });
    if (!internalSession) {
      return NextResponse.json({ error: "Unauthorized session" }, { status: 401 });
    }
    organizationId = explicitOrgId || internalSession.session.activeOrganizationId!;
  } else {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { clientId } = cartSchema.parse(body);

    // See if there's an existing active cart
    const activeCartQ = `
      SELECT * FROM carts
      WHERE "clientId" = $1 AND status = true
    `;
    const resultCart = await pool.query(activeCartQ, [clientId]);
    const cart = resultCart.rows[0];

    if (cart) {
      const cartProductsQ = `
        SELECT 
          p.id, p.title, p.description, p.image, p.sku,
          cp.quantity, cp."unitPrice"
        FROM products p
        JOIN "cartProducts" cp ON p.id = cp."productId"
        WHERE cp."cartId" = $1
      `;
      const resultCartProducts = await pool.query(cartProductsQ, [cart.id]);
      return NextResponse.json({ newCart: cart, resultCartProducts: resultCartProducts.rows }, { status: 201 });
    }

    // No existing cart → create new one
    // 1) fetch client country
    const clientQ = `SELECT country FROM clients WHERE id = $1`;
    const resultClient = await pool.query(clientQ, [clientId]);
    const country = resultClient.rows[0].country as string;

    // 2) fetch a default shipping method for this org
    const shipMethQ = `
      SELECT id FROM "shippingMethods"
      WHERE "organizationId" = $1
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;
    const shipRes = await pool.query(shipMethQ, [organizationId]);
    if (shipRes.rows.length === 0) {
      return NextResponse.json({ error: "No shipping methods available" }, { status: 400 });
    }
    const shippingMethod = shipRes.rows[0].id;

    // 3) initial cart hash for empty items
    const initialProducts: any[] = [];
    const cartHash = crypto
      .createHash("sha256")
      .update(JSON.stringify(initialProducts))
      .digest("hex");
    const cartUpdatedHash = cartHash;

    const couponCode = null;
    const status = true;
    const cartId = uuidv4();

    const insertQ = `
      INSERT INTO carts (
        id, "clientId", country, "couponCode",
        "shippingMethod", "cartHash", "cartUpdatedHash",
        status, "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING *
    `;
    const values = [
      cartId,
      clientId,
      country,
      couponCode,
      shippingMethod,
      cartHash,
      cartUpdatedHash,
      status,
    ];

    const result = await pool.query(insertQ, values);
    const newCart = result.rows[0];
    const resultCartProducts: any[] = [];

    return NextResponse.json({ newCart, resultCartProducts }, { status: 201 });
  } catch (error: any) {
    console.error("[POST /api/cart] error:", error);
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
