// src/app/api/cart/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    // 1) Load the cart
    const activeCartQ = `
      SELECT * FROM carts
      WHERE id = $1
    `;
    const resultCart = await pool.query(activeCartQ, [id]);
    const cart = resultCart.rows[0];
    const countryCart = cart.country;

    // 2) Load the client’s current country
    const countryQuery = `
      SELECT country
      FROM clients
      WHERE id = $1
    `;
    const countryResult = await pool.query(countryQuery, [cart.clientId]);
    const countryClient = countryResult.rows[0]?.country;

    // 3) If the cart’s country differs, re-price every line
    if (countryCart !== countryClient) {
      // Checkout a dedicated client so we can do a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // Update the cart’s country
        const updateCartCountryQ = `
          UPDATE carts
          SET country = $1
          WHERE id = $2
        `;
        await client.query(updateCartCountryQ, [countryClient, id]);

        // Fetch all the existing cart lines
        const cartProductsQ = `
          SELECT "productId"
          FROM "cartProducts"
          WHERE "cartId" = $1
        `;
        const resultCartProducts = await client.query(cartProductsQ, [id]);

        // For each line, look up the new price and update its unitPrice
        await Promise.all(
          resultCartProducts.rows.map(async (cp: { productId: string }) => {
            // 3a) Fetch the product’s full regularPrice JSON
            const countryProductsQ = `
              SELECT "regularPrice"
              FROM products
              WHERE id = $1
            `;
            const priceRes = await client.query(countryProductsQ, [
              cp.productId,
            ]);
            const newPrice =
              priceRes.rows[0].regularPrice[countryClient];

            // 3b) Write it back into cartProducts
            const updateLineQ = `
              UPDATE "cartProducts"
              SET "unitPrice" = $1, "updatedAt" = NOW()
              WHERE "productId" = $2 AND "cartId" = $3
            `;
            await client.query(updateLineQ, [
              newPrice,
              cp.productId,
              id,
            ]);
          })
        );

        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    }

    // 4) Finally, select & return the up-to-date cart lines
    const cartProductsQ = `
      SELECT 
        p.id, p.title, p.description, p.image, p.sku,
        cp.quantity, cp."unitPrice"
      FROM products p
      JOIN "cartProducts" cp ON p.id = cp."productId"
      WHERE cp."cartId" = $1
    `;
    const finalCartProducts = await pool.query(cartProductsQ, [id]);

    return NextResponse.json(
      { resultCartProducts: finalCartProducts.rows },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("[GET /api/cart/[id]] error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
