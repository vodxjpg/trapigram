// src/app/api/cart/[id]/add-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";;
import { v4 as uuidv4 } from "uuid";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { resolveUnitPrice } from "@/lib/pricing";
import { adjustStock } from "@/lib/stock";
import { getStepsFor, getPriceForQuantity, tierPricing } from "@/lib/tier-pricing";



const cartProductSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;

  try {
    const { id: cartId } = await params;
    const body = cartProductSchema.parse(await req.json());

    /* ───── get client/country/level in one roundtrip ───── */
    const { rows: clientRows } = await pool.query(
      `SELECT c.country, c."levelId"
         FROM carts ca
         JOIN clients c ON c.id = ca."clientId"
        WHERE ca.id = $1`,
      [cartId]
    );
    if (!clientRows.length)
      return NextResponse.json({ error: "Cart or client not found" }, { status: 404 });

    const { country, levelId } = clientRows[0];

    /* ───── price resolution (pts or €) ───── */
    const { price, isAffiliate } = await resolveUnitPrice(
      body.productId,
      country,
      levelId
    );

    /*  guard: affiliate product MUST have a points price */
    if (isAffiliate && price === 0)
      return NextResponse.json({ error: "No points price configured for this product" }, { status: 400 });

    /* ─────────────── transaction ─────────────── */
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      /* ─── 1) points check & debit (affiliate only) ─── */
      if (isAffiliate) {
        const pointsNeeded = price * body.quantity;       // pts / unit × units

        const { rows: bal } = await client.query(
          `SELECT "pointsCurrent"
             FROM "affiliatePointBalances"
            WHERE "organizationId" = $1
              AND "clientId"      = (SELECT "clientId" FROM carts WHERE id = $2)`,
          [organizationId, cartId]
        );
        const current = bal[0]?.pointsCurrent ?? 0;
        if (pointsNeeded > current) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Insufficient affiliate points", required: pointsNeeded, available: current },
            { status: 400 }
          );
        }

        /* debit + log ---------------------------------- */
        await client.query(
          `UPDATE "affiliatePointBalances"
              SET "pointsCurrent" = "pointsCurrent" - $1,
                  "pointsSpent"   = "pointsSpent"   + $1,
                  "updatedAt"     = NOW()
            WHERE "organizationId" = $2
              AND "clientId"      = (SELECT "clientId" FROM carts WHERE id = $3)`,
          [pointsNeeded, organizationId, cartId]
        );
        await client.query(
          `INSERT INTO "affiliatePointLogs"
            (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES (gen_random_uuid(),$1,
                  (SELECT "clientId" FROM carts WHERE id=$2),
                  $3,'redeem','add to cart',NOW(),NOW())`,
          [organizationId, cartId, -pointsNeeded]
        );
      }

      /* ─── 2) upsert cartProducts ─── */
      const { rows: existing } = await client.query(
        `SELECT id, quantity
           FROM "cartProducts"
          WHERE "cartId" = $1
            AND ${isAffiliate ? `"affiliateProductId"` : `"productId"`} = $2`,
        [cartId, body.productId]
      );

      let quantity = body.quantity;
      const tiers: Tier[] = await tierPricing(organizationId);
      const steps         = getStepsFor(tiers, country, body.productId);
      let tpprice         = getPriceForQuantity(steps, quantity) ?? price;

      if (existing.length) {
        quantity += existing[0].quantity;
        tpprice   = getPriceForQuantity(steps, quantity) ?? price;

        await client.query(
          `UPDATE "cartProducts"
              SET quantity   = $1,
                  "unitPrice" = $2,
                  "updatedAt" = NOW()
            WHERE id = $3`,
          [quantity, tpprice, existing[0].id]
        );
      } else {
        await client.query(
          `INSERT INTO "cartProducts"
            (id,"cartId","productId","affiliateProductId",
             quantity,"unitPrice","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())`,
          [
            uuidv4(),
            cartId,
            isAffiliate ? null : body.productId,
            isAffiliate ? body.productId : null,
            quantity,
            tpprice,
          ]
        );
      }

      /* ─── 3) reserve stock ─── */
      await adjustStock(client, body.productId, country, -body.quantity);

      /* ─── 4) cart hash ─── */
      const { rows: rowsHash } = await client.query(
        `SELECT COALESCE("productId","affiliateProductId") AS pid,
                quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId" = $1`,
        [cartId]
      );
      const newHash = crypto.createHash("sha256")
        .update(JSON.stringify(rowsHash))
        .digest("hex");
      await client.query(
        `UPDATE carts
            SET "cartUpdatedHash"=$1,"updatedAt"=NOW()
          WHERE id=$2`,
        [newHash, cartId]
      );

      await client.query("COMMIT");

      /* ─── 5) build response payload (same shape as before) ─── */
      const prodQuery = isAffiliate
        ? `SELECT id,title,description,image,sku FROM "affiliateProducts" WHERE id = $1`
        : `SELECT id,title,description,image,sku,"regularPrice" FROM products WHERE id = $1`;
      const { rows: prodRows } = await pool.query(prodQuery, [body.productId]);

      const base = prodRows[0];
      const product = {
        id:         base.id,
        title:      base.title,
        sku:        base.sku,
        description:base.description,
        image:      base.image,
        regularPrice: isAffiliate ? {} : base.regularPrice ?? {},
        price:      tpprice,
        stockData:  {},
        subtotal:   Number(tpprice) * quantity,
      };

      return NextResponse.json({ product, quantity }, { status: 201 });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.error("[POST /api/cart/:id/add-product]", err);
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.errors }, { status: 400 });
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}
