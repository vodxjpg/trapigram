// src/app/api/cart/[id]/update-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Pool, PoolClient } from "pg";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { getStepsFor, getPriceForQuantity, tierPricing } from "@/lib/tier-pricing"

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const cartProductSchema = z.object({
  productId: z.string(),
  quantity: z.number(),
  action: z.enum(["add", "subtract"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: cartId } = await params;

  try {
    const body = await req.json();
    const data = cartProductSchema.parse(body);

    // 1) Fetch cart-item and client info
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows: cRows } = await client.query(
        `SELECT cl.country, cl."levelId", cl.id AS "clientId", cp.quantity, cp."affiliateProductId"
           FROM clients cl
           JOIN carts ca ON ca."clientId" = cl.id
           JOIN "cartProducts" cp ON cp."cartId" = ca.id
          WHERE ca.id = $1
            AND (cp."productId" = $2 OR cp."affiliateProductId" = $2)
        `,
        [cartId, data.productId]
      );
      if (!cRows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Cart item not found" }, { status: 404 });
      }
      const {
        country,
        levelId,
        clientId,
        quantity: oldQty,
        affiliateProductId,
      } = cRows[0] as { country: string; levelId: string; clientId: string; quantity: number; affiliateProductId: string | null };
      const isAffiliate = Boolean(affiliateProductId);

      const { rows: pRows } = await client.query(
        `SELECT "regularPrice" FROM products WHERE id='${data.productId}'`
      )

      const regularPrice = pRows[0].regularPrice[country]

      // compute new quantity
      const newQty = data.action === "add" ? oldQty + 1 : oldQty - 1;
      if (newQty < 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Quantity cannot be negative" }, { status: 400 });
      }

      let ptsNeeded = 0;
      if (isAffiliate) {
        // 2) fetch point prices
        const { rows: apRows } = await client.query(
          `SELECT "regularPoints", "salePoints"
             FROM "affiliateProducts"
            WHERE id = $1`,
          [data.productId]
        );
        const { regularPoints, salePoints } = apRows[0] as { regularPoints: Record<string, Record<string, number>>; salePoints: Record<string, Record<string, number>> | null };
        const countryReg = regularPoints[country] || {};
        const countrySale = salePoints?.[country] || {};
        const pointsPerUnit = countrySale[levelId] ?? countryReg[levelId] ?? 0;

        const deltaQty = newQty - oldQty;
        ptsNeeded = deltaQty > 0 ? deltaQty * pointsPerUnit : 0;

        // 3) check balance
        const { rows: balRows } = await client.query(
          `SELECT "pointsCurrent"
             FROM "affiliatePointBalances"
            WHERE "organizationId" = $1 AND "clientId" = $2`,
          [organizationId, clientId]
        );
        const pointsCurrent = balRows[0]?.pointsCurrent ?? 0;
        if (ptsNeeded > pointsCurrent) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            {
              error: "Insufficient affiliate points",
              required: ptsNeeded,
              available: pointsCurrent,
            },
            { status: 400 }
          );
        }

        // 4) update balance
        await client.query(
          `UPDATE "affiliatePointBalances"
             SET "pointsCurrent" = "pointsCurrent" - $1,
                 "pointsSpent"   = "pointsSpent" + $1,
                 "updatedAt"     = NOW()
           WHERE "organizationId" = $2 AND "clientId" = $3`,
          [ptsNeeded, organizationId, clientId]
        );

        // 5) log it
        await client.query(
          `INSERT INTO "affiliatePointLogs"
             (id, "organizationId", "clientId", points, action, description, "createdAt", "updatedAt")
           VALUES (gen_random_uuid(), $1, $2, $3, 'redeem', 'cart quantity update', NOW(), NOW())`,
          [organizationId, clientId, -ptsNeeded]
        );
      }

      const tierPricings = await tierPricing(organizationId)
      const tiers: Tier[] = tierPricings;

      const steps = getStepsFor(tiers, country, data.productId);
      let price = getPriceForQuantity(steps, newQty);

      if (price === null) {
        price = regularPrice
      }

      // 6) update cartProducts
      const { rows: upd } = await client.query(
        `UPDATE "cartProducts"
           SET quantity   = $1, "unitPrice" = $2,
               "updatedAt" = NOW()
         WHERE "cartId"   = $3
           AND ("productId" = $4 OR "affiliateProductId" = $4)
         RETURNING *`,
        [newQty, price, cartId, data.productId]
      );
      const updatedRow = upd[0];

      // 7) adjust stock
      const deltaStock = data.action === "add" ? -1 : +1;
      await adjustStock(client, data.productId, country, deltaStock);

      await client.query("COMMIT");

      // 8) fetch product details for response
      let product: any;
      if (isAffiliate) {
        const { rows: pRows } = await pool.query(
          `SELECT id, title, sku, description, image
             FROM "affiliateProducts"
            WHERE id = $1`,
          [data.productId]
        );
        product = pRows[0];
        product.price = updatedRow.unitPrice;
        product.subtotal = updatedRow.unitPrice * updatedRow.quantity;
        product.regularPrice = {};
        product.stockData = {};
        product.isAffiliate = true;
      } else {
        const { rows: pRows } = await pool.query(
          `SELECT id, title, sku, description, image, "regularPrice"
             FROM products
            WHERE id = $1`,
          [data.productId]
        );
        product = pRows[0];
        product.price = price;
        product.subtotal = Number(price) * updatedRow.quantity;
        product.stockData = {};
        product.isAffiliate = false;
      }

      // 9) update cart hash
      const encryptedResponse = crypto
        .createHash('sha256')
        .update(JSON.stringify(updatedRow))
        .digest('base64');
      await pool.query(
        `UPDATE carts SET "cartUpdatedHash" = $1, "updatedAt" = NOW() WHERE id = $2`,
        [encryptedResponse, cartId]
      );

      return NextResponse.json(
        { product, quantity: updatedRow.quantity },
        { status: 200 }
      );
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[PATCH /api/cart/:id/update-product]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
