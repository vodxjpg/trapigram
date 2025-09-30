// src/app/api/cart/[id]/route.ts   ← full file, only response shape changed
import { NextRequest, NextResponse } from "next/server";
import { pgPool as pool } from "@/lib/db";;
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";

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
    await pool.query(`UPDATE carts SET "couponCode" = NULL WHERE id = $1`, [id])

    const clientRes = await pool.query(
      `SELECT country,"levelId" FROM clients WHERE id=$1`,
      [cart.clientId]
    );
    const client = clientRes.rows[0];

    /* 2. Re-price if the client’s country changed */
    if (cart.country !== client.country) {
      const tx = await pool.connect();
      try {
        const removedItems: { productId: string; reason: string }[] = [];
        await tx.query("BEGIN");
        await tx.query(
          `UPDATE carts SET country=$1 WHERE id=$2`,
          [client.country, id],
        );

        const { rows: lines } = await tx.query<{ id: string; productId: string }>(
          `SELECT id,"productId",quantity FROM "cartProducts" WHERE "cartId"=$1`,
          [id],
        );
        for (const line of lines) {
          try {
            const { price } = await resolveUnitPrice(
              line.productId,
              client.country,
              client.levelId,
            );
            await tx.query(
              `UPDATE "cartProducts"
                            SET "unitPrice" = $1, "updatedAt" = NOW()
                          WHERE id = $2`,
              [price, line.id],
            );
          } catch (err: any) {
            if (err.message.startsWith("No money price for")) {
              // remove the bad line and record it
              await tx.query(
                `DELETE FROM "cartProducts" WHERE id = $1`,
                [line.id],
              );
              removedItems.push({
                productId: line.productId,
                reason: err.message,  // e.g. "No money price for GB"
              });
              continue;
            }
            // any other error: rollback everything
            throw err;
          }
        }

        await tx.query("COMMIT");
        // stash removedItems in the transaction-scoped variable for later
        ; (tx as any).removedItems = removedItems;
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
      p.id, p.title, p.description, p.image, p.sku,
      cp.quantity, cp."unitPrice",
      cp."variationId",
      cp."createdAt",
      false AS "isAffiliate"
     FROM products p
     JOIN "cartProducts" cp ON p.id = cp."productId"
     WHERE cp."cartId" = $1
   `;
    const affQ = `
    SELECT
      ap.id, ap.title, ap.description, ap.image, ap.sku,
      cp.quantity, cp."unitPrice",
      cp."variationId",
      cp."createdAt",
      true  AS "isAffiliate"
     FROM "affiliateProducts" ap
     JOIN "cartProducts" cp ON ap.id = cp."affiliateProductId"
     WHERE cp."cartId" = $1
   `;

    const [prod, aff] = await Promise.all([
      pool.query(prodQ, [id]),
      pool.query(affQ, [id]),
    ]);

    const lines = [...prod.rows, ...aff.rows]
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((l: any) => ({
        ...l, // now includes variationId
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.unitPrice) * l.quantity,
      }));



    // extract removedItems if we re-priced above
    const removedItems =
      // tx.removedItems only exists if we entered the country-change block
      (await pool).removedItems as { productId: string; reason: string }[] ||
      [];

    /* 4. Return both legacy and new keys */
    return NextResponse.json(
      {
        resultCartProducts: lines,
        lines,
        removedItems,      // caller can inspect this
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[GET /api/cart/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}