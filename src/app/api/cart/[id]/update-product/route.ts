// src/app/api/cart/[id]/update-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import {
  tierPricing,
  getPriceForQuantity,
  type Tier,
} from "@/lib/tier-pricing";
import { resolveUnitPrice } from "@/lib/pricing";

/* ─────────────────────────────── */
const cartProductSchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  quantity: z.number().optional(),
  action: z.enum(["add", "subtract"]),
});

/**
 * Same selection logic as add-product: country case-insensitive and
 * only compare variationIds when the current line has a variation.
 */

function findTier(
  tiers: Tier[],
  country: string,
  productId: string,
  variationId: string | null,
  clientId?: string | null,
): Tier | null {
  const CC = (country || "").toUpperCase();
  const inTier = (t: Tier) =>
    t.active === true &&
    t.countries.some((c) => (c || "").toUpperCase() === CC) &&
    t.products.some(
      (p) =>
        (p.productId && p.productId === productId) ||
        (!!variationId && p.variationId === variationId),
    );
  const candidates = tiers.filter(inTier);
   if (!candidates.length) return null;

  const targets = (t: Tier): string[] =>
    ((((t as any).clients as string[] | undefined) ??
      ((t as any).customers as string[] | undefined) ??
      []) as string[]).filter(Boolean);

  if (clientId) {
    const targeted = candidates.find((t) => targets(t).includes(clientId));
    if (targeted) return targeted;
  }
  const global = candidates.find((t) => targets(t).length === 0);
  return global ?? null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { organizationId } = ctx;
  const { id: cartId } = await params;

  try {
    const data = cartProductSchema.parse(await req.json());

    // normalize variationId: ensure `string | null` (never undefined/empty)
    const variationId: string | null =
      typeof data.variationId === "string" && data.variationId.trim().length > 0
        ? data.variationId
        : null;
    const withVariation = variationId !== null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      /* 1️⃣ cart line + client context */
      const { rows: cRows } = await client.query(
        `SELECT cl.country,
                cl."levelId",
                cl.id                    AS "clientId",
                cp.quantity,
                cp."affiliateProductId",
                ca."channel"
           FROM clients            cl
           JOIN carts              ca ON ca."clientId" = cl.id
           JOIN "cartProducts"     cp ON cp."cartId"   = ca.id
         WHERE ca.id = $1
  AND (cp."productId" = $2 OR cp."affiliateProductId" = $2)
  ${withVariation ? 'AND cp."variationId" = $3' : ''}`,
        [cartId, data.productId, ...(withVariation ? [variationId] : [])],

      );
      if (!cRows.length) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Cart item not found" },
          { status: 404 },
        );
      }
      const {
        country,
        levelId,
        clientId,
        quantity: oldQty,
        affiliateProductId,
        channel,
      } = cRows[0] as {
        country: string;
        levelId: string;
        clientId: string;
        quantity: number;
        affiliateProductId: string | null;
        channel: "web" | "pos" | null;
      };
      const isAffiliate = Boolean(affiliateProductId);

      /* 2️⃣ base price / points per unit */
      let basePrice: number;
      if (isAffiliate) {
        const { rows: apRows } = await client.query(
          `SELECT "regularPoints","salePoints"
             FROM "affiliateProducts"
            WHERE id = $1`,
          [data.productId],
        );
        const { regularPoints, salePoints } = apRows[0] as {
          regularPoints: Record<string, Record<string, number>>;
          salePoints: Record<string, Record<string, number>> | null;
        };
        basePrice =
          salePoints?.[levelId]?.[country] ??
          salePoints?.default?.[country] ??
          regularPoints[levelId]?.[country] ??
          regularPoints.default?.[country] ??
          0;
        if (basePrice === 0) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "No points price configured for this product" },
            { status: 400 },
          );
        }
      } else {
        const p = await resolveUnitPrice(data.productId, variationId, country, levelId);
        basePrice = p.price;
      }

            /* POS-only guard: disallow shared products for POS carts */
      if (channel === "pos" && !isAffiliate) {
        const { rows: prodOrgRows } = await client.query<{ organizationId: string }>(
          `SELECT "organizationId" FROM products WHERE id = $1`,
          [data.productId],
        );
        if (!prodOrgRows.length) {
          await client.query("ROLLBACK");
          return NextResponse.json(
            { error: "Product not found" },
            { status: 404 },
          );
        }
        if (prodOrgRows[0].organizationId !== organizationId) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Shared products are not allowed in POS" }, { status: 403 });
        }
      }

      /* 3️⃣ compute new quantity */
      const newQty = data.action === "add" ? oldQty + 1 : oldQty - 1;
      if (newQty < 0) {
        await client.query("ROLLBACK");
        return NextResponse.json(
          { error: "Quantity cannot be negative" },
          { status: 400 },
        );
      }

      /* 4️⃣ affiliate balance flow (unchanged) */
      if (isAffiliate) {
        const deltaQty = newQty - oldQty;
        if (deltaQty !== 0) {
          const absPoints = Math.abs(deltaQty) * basePrice;
          const { rows: balRows } = await client.query(
            `SELECT "pointsCurrent"
               FROM "affiliatePointBalances"
              WHERE "organizationId" = $1 AND "clientId" = $2`,
            [organizationId, clientId],
          );
          const pointsCurrent = balRows[0]?.pointsCurrent ?? 0;

          if (deltaQty > 0) {
            if (absPoints > pointsCurrent) {
              await client.query("ROLLBACK");
              return NextResponse.json(
                {
                  error: "Insufficient affiliate points",
                  required: absPoints,
                  available: pointsCurrent,
                },
                { status: 400 },
              );
            }
            await client.query(
              `UPDATE "affiliatePointBalances"
                 SET "pointsCurrent" = "pointsCurrent" - $1,
                     "pointsSpent"   = "pointsSpent"   + $1,
                     "updatedAt"     = NOW()
               WHERE "organizationId" = $2 AND "clientId" = $3`,
              [absPoints, organizationId, clientId],
            );
            await client.query(
              `INSERT INTO "affiliatePointLogs"
                 (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
               VALUES (gen_random_uuid(),$1,$2,$3,'redeem','cart quantity update',NOW(),NOW())`,
              [organizationId, clientId, -absPoints],
            );
          } else {
            await client.query(
              `UPDATE "affiliatePointBalances"
                 SET "pointsCurrent" = "pointsCurrent" + $1,
                     "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                     "updatedAt"     = NOW()
               WHERE "organizationId" = $2 AND "clientId" = $3`,
              [absPoints, organizationId, clientId],
            );
            await client.query(
              `INSERT INTO "affiliatePointLogs"
                 (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
               VALUES (gen_random_uuid(),$1,$2,$3,'refund','cart quantity update',NOW(),NOW())`,
              [organizationId, clientId, absPoints],
            );
          }
        }
      }

      /* 5️⃣ tier-pricing for normal products */
      let pricePerUnit = basePrice;
      if (!isAffiliate) {
        const tiers = (await tierPricing(organizationId)) as Tier[];
        const tier = findTier(tiers, country, data.productId, variationId, clientId);
        console.log(tier)

        if (tier) {
          const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
          const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];
          const { rows: sumRow } = await client.query(
            `SELECT COALESCE(SUM(quantity),0)::int AS qty
                 FROM "cartProducts"
                WHERE "cartId" = $1
                  AND ( ("productId" = ANY($2::text[]))
                        OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
            [cartId, tierProdIds, tierVarIds],
          );

          const qtyBefore = Number(sumRow[0].qty);
          const qtyAfter = qtyBefore - oldQty + newQty;

          pricePerUnit = getPriceForQuantity(tier.steps, qtyAfter) ?? basePrice;

          await client.query(
            `UPDATE "cartProducts"
              SET "unitPrice" = $1,
                  "updatedAt" = NOW()
            WHERE "cartId" = $2
              AND (
                ("productId" = ANY($3::text[]))
                OR ("variationId" IS NOT NULL AND "variationId" = ANY($4::text[]))
              )`,
            [pricePerUnit, cartId, tierProdIds, tierVarIds],
          );

        }
      }

      /* 6️⃣ persist: delete row if newQty = 0, else update */
      if (newQty === 0) {
        await client.query(
          `DELETE FROM "cartProducts"
                WHERE "cartId"   = $1
                  AND ("productId" = $2 OR "affiliateProductId" = $2)
                  ${withVariation ? 'AND "variationId" = $3' : ''}`,
          [cartId, data.productId, ...(withVariation ? [variationId] : [])],
        );
      } else {
        await client.query(
          `UPDATE "cartProducts"
                  SET quantity    = $1,
                      "unitPrice" = $2,
                      "updatedAt" = NOW()
                WHERE "cartId"   = $3
                AND ("productId" = $4 OR "affiliateProductId" = $4)
                ${withVariation ? 'AND "variationId" = $5' : ''}`,
          [newQty, pricePerUnit, cartId, data.productId, ...(withVariation ? [variationId] : [])],

        );
      }

      /* 7️⃣ stock adjust (negative on add, positive on subtract) */
      await adjustStock(client, data.productId, variationId, country, data.action === "add" ? -1 : 1);


      /* 8️⃣ update cart hash after all changes */
      const { rows: linesForHash } = await client.query(
        `SELECT COALESCE("productId","affiliateProductId") AS pid,
                quantity,"unitPrice"
           FROM "cartProducts"
          WHERE "cartId" = $1`,
        [cartId],
      );
      const newHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(linesForHash))
        .digest("hex");
      await client.query(
        `UPDATE carts
            SET "cartUpdatedHash" = $1,
                "updatedAt"      = NOW()
          WHERE id = $2`,
        [newHash, cartId],
      );

      await client.query("COMMIT");

      /* 9️⃣ full snapshot for the client */
      const lines = await fetchLines(cartId);
      return NextResponse.json({ lines });

      /* helper */
      async function fetchLines(cid: string) {
        const c = await pool.connect();
        try {
          const [p, a] = await Promise.all([
            c.query(
              `SELECT p.id,p.title,p.description,p.image,p.sku,
       cp.quantity,cp."unitPrice",cp."variationId",false AS "isAffiliate"
                 FROM products p
                 JOIN "cartProducts" cp ON cp."productId" = p.id
                WHERE cp."cartId" = $1
                ORDER BY cp."createdAt"`,
              [cid],
            ),
            c.query(
              `SELECT ap.id,ap.title,ap.description,ap.image,ap.sku,
       cp.quantity,cp."unitPrice",cp."variationId",true AS "isAffiliate"

                 FROM "affiliateProducts" ap
                 JOIN "cartProducts"    cp ON cp."affiliateProductId" = ap.id
                WHERE cp."cartId" = $1
                ORDER BY cp."createdAt"`,
              [cid],
            ),
          ]);

          return [...p.rows, ...a.rows].map((l: any) => ({
            ...l, // includes variationId
            unitPrice: Number(l.unitPrice),
            subtotal: Number(l.unitPrice) * l.quantity,
          }));
        } finally {
          c.release();
        }
      }
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
    return NextResponse.json(
      { error: err.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
