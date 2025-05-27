// src/app/api/cart/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { Pool } from "pg";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const { id } = await params;

    /* 1. Load cart + client */
    const cartRes = await pool.query(`SELECT * FROM carts WHERE id=$1`, [id]);
    if (!cartRes.rowCount)
      return NextResponse.json({ error: "Cart not found" }, { status: 404 });
    const cart = cartRes.rows[0];

    const clientRes = await pool.query(
      `SELECT country,"levelId" FROM clients WHERE id=$1`,
      [cart.clientId]
    );
    const client = clientRes.rows[0];

    /* 2. Re-price if the client’s country changed */
    if (cart.country !== client.country) {
      const tx = await pool.connect();
      try {
        await tx.query("BEGIN");
        await tx.query(`UPDATE carts SET country=$1 WHERE id=$2`, [
          client.country,
          id,
        ]);

        const { rows: lines } = await tx.query(
          `SELECT id,"productId",quantity FROM "cartProducts" WHERE "cartId"=$1`,
          [id]
        );
        for (const line of lines) {
          const { price } = await resolveUnitPrice(
            line.productId,
            client.country,
            client.levelId
          );
          await tx.query(
            `UPDATE "cartProducts"
             SET "unitPrice"=$1,"updatedAt"=NOW()
             WHERE id=$2`,
            [price, line.id]
          );
        }
        await tx.query("COMMIT");
      } catch (e) {
        await tx.query("ROLLBACK");
        throw e;
      } finally {
        tx.release();
      }
    }

    /* 3. Assemble normal + affiliate products */
       const prodQ = `
     SELECT
       p.id,
       p.title,
       p.description,
       p.image,
       p.sku,
       cp.quantity,
       cp."unitPrice",
       false AS "isAffiliate"
     FROM products p
     JOIN "cartProducts" cp
       ON p.id = cp."productId"
     WHERE cp."cartId" = $1
   `;
      const affQ = `
     SELECT
       ap.id,
       ap.title,
       ap.description,
       ap.image,
       ap.sku,
       cp.quantity,
       cp."unitPrice",
       true  AS "isAffiliate"
     FROM "affiliateProducts" ap
     JOIN "cartProducts" cp
       ON ap.id = cp."affiliateProductId"
     WHERE cp."cartId" = $1
   `;

    const [prod, aff] = await Promise.all([
      pool.query(prodQ, [id]),
      pool.query(affQ, [id]),
    ]);

    const lines = [...prod.rows, ...aff.rows].map((l: any) => ({
      ...l,
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.unitPrice) * l.quantity,
    }));

    /* 4. Return both legacy and new keys */
    return NextResponse.json(
      { resultCartProducts: lines, lines },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[GET /api/cart/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
