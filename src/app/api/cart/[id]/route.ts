import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    const activeCartQ = `
      SELECT * FROM carts
      WHERE "id" = $1
    `;
    const resultCart = await pool.query(activeCartQ, [id]);
    const cart = resultCart.rows[0];

    const countryCart = cart.country

    const countryQuery = `
      SELECT country
      FROM clients
      WHERE id = '${cart.clientId}'
    `;

    const countryResult = await pool.query(countryQuery);
    const clientCountry = countryResult.rows[0]

    const countryClient = clientCountry.country

    if (countryCart !== countryClient) {
      const updateCartCountry = `
      UPDATE carts
      SET country = '${countryClient}'
      WHERE id = '${id}'
      `
      await pool.query(updateCartCountry);

      const cartProductsQ = `
        SELECT 
          p.id, p.title, p.description, p.image, p.sku,
          cp.quantity, cp."unitPrice"
        FROM products p
        JOIN "cartProducts" cp ON p.id = cp."productId"
        WHERE cp."cartId" = $1
      `;
      const resultCartProducts = await pool.query(cartProductsQ, [id]);

      resultCartProducts.rows.map(async (cp: any) => {
        const countryProducts = `
        SELECT "regularPrice" FROM products WHERE id='${cp.id}'
      `
        const result = await pool.query(countryProducts);

        const updateCart = `UPDATE "cartProducts" SET "unitPrice" = ${result.rows[0].regularPrice[countryClient]} WHERE "productId" = '${cp.id}' AND "cartId" = '${id}' `
        await pool.query(updateCart);
      })

      const newResultCartProducts = await pool.query(cartProductsQ, [id]);

      return NextResponse.json({ resultCartProducts: newResultCartProducts.rows }, { status: 201 });
    }

    const cartProductsQ = `
        SELECT 
          p.id, p.title, p.description, p.image, p.sku,
          cp.quantity, cp."unitPrice"
        FROM products p
        JOIN "cartProducts" cp ON p.id = cp."productId"
        WHERE cp."cartId" = $1
      `;
    const resultCartProducts = await pool.query(cartProductsQ, [id]);
    return NextResponse.json({ resultCartProducts: resultCartProducts.rows }, { status: 201 });
  } catch (error: any) {
    console.error("[GET /api/coupons/[id]] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}