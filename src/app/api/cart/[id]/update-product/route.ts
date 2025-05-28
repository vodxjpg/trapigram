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

  const { id: cartId }           = params;
  const { productId, action }    = updateSchema.parse(await req.json());

  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");

    /* ─────────────────────────────────────────────────────────────
       1) Load all rows of *this* product already in the cart
          (newest first so SUBTRACT pops the latest one)          */
    const { rows: existing } = await tx.query(
      `SELECT
         cp.id                              AS "lineId",
         cp.quantity                        AS qty,
         cp."unitPrice"                     AS "unitPrice",
         cp."affiliateProductId" IS NOT NULL AS "isAffiliate",
         cl.id                              AS "clientId",
         cl.country                         AS country,
         cl."levelId"                       AS "levelId"
       FROM "cartProducts" cp
       JOIN carts   c  ON c.id  = cp."cartId"
       JOIN clients cl ON cl.id = c."clientId"
       WHERE c.id = $1
         AND (cp."productId" = $2 OR cp."affiliateProductId" = $2)
       ORDER BY cp."createdAt" DESC`,
      [cartId, productId]
    );

    /* we’ll need these three values in both ADD and SUBTRACT paths  */
    let country   = existing[0]?.country;
    let levelId   = existing[0]?.levelId;
    let clientId  = existing[0]?.clientId;

    /* if no prior rows, fetch client info directly from the cart   */
    if (!country) {
      const { rows: [cli] } = await tx.query(
        `SELECT cl.id AS "clientId", cl.country, cl."levelId"
           FROM clients cl
           JOIN carts c ON c."clientId" = cl.id
          WHERE c.id = $1`,
        [cartId]
      );
      country  = cli.country;
      levelId  = cli.levelId;
      clientId = cli.clientId;
    }

    /*──────────────────────── 2) SUBTRACT ────────────────────────*/
    if (action === "subtract") {
      if (!existing.length) {
        await tx.query("ROLLBACK");
        return NextResponse.json(
          { error: "Cannot subtract—no existing units" },
          { status: 400 }
        );
      }

      let unitsToRemove = 1;
      for (const row of existing) {
        if (unitsToRemove <= 0) break;

        const removeQty = Math.min(row.qty, unitsToRemove);

        /* 2a. lower quantity / delete later if hits zero            */
        await tx.query(
          `UPDATE "cartProducts"
             SET quantity  = quantity - $1,
                 "updatedAt" = NOW()
           WHERE id = $2`,
          [removeQty, row.lineId]
        );

        /* 2b. restock                                              */
        await adjustStock(tx, productId, row.country, +removeQty);

        /* 2c. refund points if it was an affiliate line            */
        if (row.isAffiliate) {
          const pointsToCredit = Number(row.unitPrice) * removeQty;

          /* ensure balance row exists & lock it */
          await tx.query(
            `INSERT INTO "affiliatePointBalances"
               ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
             VALUES ($1,$2,0,0,NOW(),NOW())
             ON CONFLICT ("clientId","organizationId") DO NOTHING`,
            [row.clientId, ctx.organizationId]
          );

          await tx.query(
            `UPDATE "affiliatePointBalances"
               SET "pointsCurrent" = "pointsCurrent" + $1,
                   "updatedAt"     = NOW()
             WHERE "clientId" = $2 AND "organizationId" = $3`,
            [pointsToCredit, row.clientId, ctx.organizationId]
          );

          await tx.query(
            `INSERT INTO "affiliatePointLogs"
               (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
             VALUES ($1,$2,$3,$4,'refund','Removed product from cart',NOW(),NOW())`,
            [uuidv4(), ctx.organizationId, row.clientId, pointsToCredit]
          );
        }

        unitsToRemove -= removeQty;
      }

      /* wipe zero-qty rows                                         */
      await tx.query(
        `DELETE FROM "cartProducts" WHERE "cartId" = $1 AND quantity = 0`,
        [cartId]
      );
    }

    /*──────────────────────── 3) ADD ─────────────────────────────*/
    else {
      /* 3a. look up price (€/pts) and affiliate flag               */
      const { price, isAffiliate } = await resolveUnitPrice(
        productId,
        country!,
        levelId!
      );

      /*──────────────── affiliate validations ────────────────────*/
      if (isAffiliate) {
        /* ♦ level check                                            */
        const { rows: [{ minLevelId }] } = await tx.query(
          `SELECT "minLevelId" FROM "affiliateProducts" WHERE id = $1`,
          [productId]
        );
        if (minLevelId && minLevelId !== levelId) {
          await tx.query("ROLLBACK");
          return NextResponse.json(
            { error: "Client level is not high enough for this product" },
            { status: 400 }
          );
        }

        /* ♦ balance row (lock or create)                           */
        const balRes = await tx.query(
          `SELECT "pointsCurrent"
             FROM "affiliatePointBalances"
            WHERE "clientId" = $1 AND "organizationId" = $2
            FOR UPDATE`,
          [clientId, ctx.organizationId]
        );
        if (!balRes.rowCount) {
          await tx.query(
            `INSERT INTO "affiliatePointBalances"
               ("clientId","organizationId","pointsCurrent","pointsSpent","createdAt","updatedAt")
             VALUES ($1,$2,0,0,NOW(),NOW())
             RETURNING "pointsCurrent"`,
            [clientId, ctx.organizationId]
          );
        }
        const currPts =
          balRes.rowCount ? Number(balRes.rows[0].pointsCurrent) : 0;
        if (currPts < price) {
          await tx.query("ROLLBACK");
          return NextResponse.json(
            { error: "Insufficient points balance" },
            { status: 400 }
          );
        }

        /* ♦ reserve points                                         */
        await tx.query(
          `UPDATE "affiliatePointBalances"
             SET "pointsCurrent" = "pointsCurrent" - $1,
                 "pointsSpent"   = "pointsSpent"   + $1,
                 "updatedAt"     = NOW()
           WHERE "clientId" = $2 AND "organizationId" = $3`,
          [price, clientId, ctx.organizationId]
        );
        await tx.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,'spend','Added product to cart',NOW(),NOW())`,
          [uuidv4(), ctx.organizationId, clientId, price]
        );
      }

      /* 3b. reserve stock (shared)                                 */
      await adjustStock(tx, productId, country!, -1);

      /* 3c. insert new single-unit row (price in € or pts)         */
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

    /*──────────────────────── 4) done ────────────────────────────*/
    await tx.query("COMMIT");
    const lines = await fetchLines(cartId);
    return NextResponse.json({ lines });
  } catch (err) {
    await tx.query("ROLLBACK");
    console.error(err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  } finally {
    tx.release();
  }
}

/*──────────────────────── helper (unchanged) ─────────────────────*/
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
