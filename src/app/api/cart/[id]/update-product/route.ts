// src/app/api/cart/[id]/update-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool } from "pg";
import { v4 as uuidv4 } from "uuid";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock } from "@/lib/stock";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const updateSchema = z.object({
  productId: z.string(),
  action: z.enum(["add", "subtract"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id: cartId } = params;
  const { productId, action } = updateSchema.parse(await req.json());

  const tx = await pool.connect();

  try {
    await tx.query("BEGIN");

    /* ── 1) fetch rows for this product  ───────────────────────────
       NOTE: newest-first order guarantees “subtract” undoes
       the most recently added single-unit row (true inverse of “add”). */
    const { rows: existing } = await tx.query(
      `SELECT
         cp.id         AS "lineId",
         cp.quantity   AS qty,
         cl.country    AS country,
         cl."levelId"  AS "levelId"
       FROM "cartProducts" cp
       JOIN carts   c  ON c.id        = cp."cartId"
       JOIN clients cl ON cl.id       = c."clientId"
       WHERE c.id = $1
         AND (cp."productId" = $2 OR cp."affiliateProductId" = $2)
       ORDER BY cp."createdAt" DESC`,         /* ★ changed ASC ➜ DESC */
      [cartId, productId]
    );

    if (action === "subtract") {
      if (!existing.length) {
        await tx.query("ROLLBACK");
        return NextResponse.json(
          { error: "Cannot subtract—no existing units" },
          { status: 400 }
        );
      }

      /* remove exactly one unit, starting from the LIFO row list */
      let unitsToRemove = 1;

      for (const row of existing) {
        if (unitsToRemove <= 0) break;

        const removeQty = Math.min(row.qty, unitsToRemove);

        await tx.query(
          `UPDATE "cartProducts"
             SET quantity = quantity - $1,
                 "updatedAt" = NOW()
           WHERE id = $2`,
          [removeQty, row.lineId]
        );

        await adjustStock(tx, productId, row.country, +removeQty);
        unitsToRemove -= removeQty;
      }

      // purge zero-quantity lines
      await tx.query(
        `DELETE FROM "cartProducts"
          WHERE "cartId" = $1 AND quantity = 0`,
        [cartId]
      );
    } else {
      /* ── ADD branch unchanged (appends a 1-unit line) ─────────── */
      const { country, levelId } = existing[0] ?? {};
      const { price, isAffiliate } = await resolveUnitPrice(
        productId,
        country!,
        levelId!
      );

      await adjustStock(tx, productId, country!, -1);

      await tx.query(
        `INSERT INTO "cartProducts"
           (id,"cartId","productId","affiliateProductId",quantity,"unitPrice","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,1,$5,NOW(),NOW())`,
        [
          uuidv4(),
          cartId,
          isAffiliate ? null : productId,
          isAffiliate ? productId : null,
          price,
        ]
      );
    }

    await tx.query("COMMIT");

    // 2) return current cart snapshot
    const lines = await fetchLines(cartId);
    return NextResponse.json({ lines });
  } catch (err) {
    await tx.query("ROLLBACK");
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  } finally {
    tx.release();
  }
}

/* helper identical to GET handler */
async function fetchLines(cartId: string) {
  const client = await pool.connect();
  try {
    const [p, a] = await Promise.all([
      client.query(
        `SELECT p.id, p.title, p.description, p.image, p.sku,
                cp.quantity, cp."unitPrice", false AS "isAffiliate"
           FROM products p
           JOIN "cartProducts" cp ON cp."productId" = p.id
          WHERE cp."cartId" = $1`,
        [cartId]
      ),
      client.query(
        `SELECT ap.id, ap.title, ap.description, ap.image, ap.sku,
                cp.quantity, cp."unitPrice", true AS "isAffiliate"
           FROM "affiliateProducts" ap
           JOIN "cartProducts" cp ON cp."affiliateProductId" = ap.id
          WHERE cp."cartId" = $1`,
        [cartId]
      ),
    ]);

    return [...p.rows, ...a.rows].map((l: any) => ({
      ...l,
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.unitPrice) * l.quantity,
    }));
  } finally {
    client.release();
  }
}
