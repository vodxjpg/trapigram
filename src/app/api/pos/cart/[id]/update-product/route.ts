// src/app/api/pos/cart/[id]/update-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { adjustStock } from "@/lib/stock";
import { resolveUnitPrice } from "@/lib/pricing";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";
import { emitCartToDisplay } from "@/lib/customer-display-emit";

/* ───────────────────────────────────────────────────────────── */

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any } | NextResponse>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
  }
  const method = req.method;
  const path = new URL(req.url).pathname;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO idempotency(key, method, path, "createdAt")
         VALUES ($1,$2,$3,NOW())`,
        [key, method, path]
      );
    } catch (e: any) {
      if (e?.code === "23505") {
        const { rows } = await c.query(
          `SELECT status, response FROM idempotency WHERE key=$1`,
          [key]
        );
        await c.query("COMMIT");
        if (rows[0]) return NextResponse.json(rows[0].response, { status: rows[0].status });
        return NextResponse.json({ error: "Idempotency replay but no record" }, { status: 409 });
      }
      if (e?.code === "42P01") {
        await c.query("ROLLBACK");
        const r = await exec();
        return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r instanceof NextResponse ? r.status : r.status, r instanceof NextResponse ? await r.json().catch(() => ({})) : r.body]
    );
    await c.query("COMMIT");
    return r instanceof NextResponse ? r : NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

/* ───────────────────────────────────────────────────────────── */

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  action: z.enum(["add", "subtract"]),
});

function parseStoreIdFromChannel(channel: string | null): string | null {
  if (!channel) return null;
  const m = /^pos-([^-\s]+)-/i.exec(channel);
  return m ? m[1] : null;
}

function pickTierForClient(
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

/** Inventory reader aligned with your schema. */
async function readInventoryFast(
  client: any,
  productId: string,
  variationId: string | null
): Promise<{ manage: boolean; backorder: boolean; stock: number | null }> {
  const safeQuery = async (sql: string, params: any[], sp: string) => {
    await client.query(`SAVEPOINT ${sp}`);
    try { const r = await client.query(sql, params); await client.query(`RELEASE SAVEPOINT ${sp}`); return r; }
    catch (e: any) { await client.query(`ROLLBACK TO SAVEPOINT ${sp}`); if (e?.code === "42703" || e?.code === "42P01") return { rows: [] }; throw e; }
  };

  const p = await safeQuery(
    `SELECT COALESCE("manageStock",false) AS manage,
            COALESCE("allowBackorders",false) AS backorder
       FROM products WHERE id=$1 LIMIT 1`,
    [productId],
    "inv_p",
  );

  let manage = !!p.rows?.[0]?.manage;
  let backorder = !!p.rows?.[0]?.backorder;
  let stock: number | null = null;

  if (variationId) {
    const v = await safeQuery(
      `SELECT COALESCE("manageStock",false) AS manage,
              COALESCE("allowBackorders",false) AS backorder,
              NULL::int AS stock
         FROM "productVariations" WHERE id=$1 LIMIT 1`,
      [variationId],
      "inv_v",
    );
    if (v.rows?.[0]) {
      manage = !!v.rows[0].manage || manage;
      if (v.rows[0].backorder != null) backorder = !!v.rows[0].backorder;
    }
  }
  return { manage, backorder, stock };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;

  return withIdempotency(req, async () => {
    try {
      const { id: cartId } = await params;
      const data = BodySchema.parse(await req.json());
      const variationId =
        typeof data.variationId === "string" && data.variationId.trim().length > 0
          ? data.variationId
          : null;
      const withVariation = variationId !== null;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        // FIRST try normal product line; if not, try affiliate line.
        let row: any | null = null;
        {
          const { rows } = await client.query(
            `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId",
                    cp.quantity, cp."affiliateProductId"
               FROM carts ca
               JOIN clients cl ON cl.id = ca."clientId"
               JOIN "cartProducts" cp ON cp."cartId" = ca.id
              WHERE ca.id = $1 AND cp."productId" = $2 ${withVariation ? `AND cp."variationId" = $3` : ""}`,
            [cartId, data.productId, ...(withVariation ? [variationId] : [])]
          );
          row = rows[0] ?? null;
        }
        let isAffiliate = false;
        if (!row) {
          const { rows } = await client.query(
            `SELECT ca.country, ca.channel, cl."levelId", cl.id AS "clientId",
                    cp.quantity, cp."affiliateProductId"
               FROM carts ca
               JOIN clients cl ON cl.id = ca."clientId"
               JOIN "cartProducts" cp ON cp."cartId" = ca.id
              WHERE ca.id = $1 AND cp."affiliateProductId" = $2 ${withVariation ? `AND cp."variationId" = $3` : ""}`,
            [cartId, data.productId, ...(withVariation ? [variationId] : [])]
          );
          row = rows[0] ?? null;
          if (!row) {
            await client.query("ROLLBACK");
            return NextResponse.json({ error: "Cart item not found" }, { status: 404 });
          }
          isAffiliate = true;
        }

        let { country, levelId, clientId, quantity: oldQty, channel } = row as any;

        // derive store country from channel for price fallback
        let storeCountry: string | null = null;
        const storeId = parseStoreIdFromChannel(channel ?? null);
        if (storeId) {
          const { rows: sRows } = await client.query(
            `SELECT address FROM stores WHERE id=$1 AND "organizationId"=$2`,
            [storeId, ctx.organizationId]
          );
          if (sRows[0]?.address) {
            try {
              const addr = typeof sRows[0].address === "string" ? JSON.parse(sRows[0].address) : sRows[0].address;
              if (addr?.country && typeof addr.country === "string") {
                storeCountry = String(addr.country).toUpperCase();
              }
            } catch { }
          }
        }

        // base price
        let basePrice: number;
        if (isAffiliate) {
          const { rows: ap } = await client.query(
            `SELECT "regularPoints","salePoints" FROM "affiliateProducts" WHERE id=$1`,
            [data.productId],
          );
          const lvl = (levelId ?? "default") as string;
          basePrice =
            ap[0]?.salePoints?.[lvl]?.[country] ??
            ap[0]?.salePoints?.default?.[country] ??
            ap[0]?.regularPoints?.[lvl]?.[country] ??
            ap[0]?.regularPoints?.default?.[country] ?? 0;
          if (basePrice === 0) {
            if (storeCountry && storeCountry !== country) {
              basePrice =
                ap[0]?.salePoints?.[lvl]?.[storeCountry] ??
                ap[0]?.salePoints?.default?.[storeCountry] ??
                ap[0]?.regularPoints?.[lvl]?.[storeCountry] ??
                ap[0]?.regularPoints?.default?.[storeCountry] ?? 0;
              if (basePrice > 0) {
                country = storeCountry;
                await client.query(`UPDATE carts SET country=$1 WHERE id=$2`, [country, cartId]);
              } else {
                await client.query("ROLLBACK");
                return NextResponse.json({ error: "No points price configured for this product" }, { status: 400 });
              }
            } else {
              await client.query("ROLLBACK");
              return NextResponse.json({ error: "No points price configured for this product" }, { status: 400 });
            }
          }
        } else {
          try {
            basePrice = (await resolveUnitPrice(data.productId, variationId, country, (levelId ?? "default") as string)).price;
          } catch (e: any) {
            if (storeCountry && storeCountry !== country) {
              basePrice = (await resolveUnitPrice(data.productId, variationId, storeCountry, (levelId ?? "default") as string)).price;
              country = storeCountry;
              await client.query(`UPDATE carts SET country=$1 WHERE id=$2`, [country, cartId]);
            } else {
              throw e;
            }
          }
        }

        // new quantity
        const newQty = data.action === "add" ? oldQty + 1 : oldQty - 1;
        if (newQty < 0) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "Quantity cannot be negative" }, { status: 400 });
        }

        // affiliate points delta
        if (isAffiliate) {
          const deltaQty = newQty - oldQty;
          if (deltaQty !== 0) {
            const absPoints = Math.abs(deltaQty) * basePrice;
            const { rows: balRows } = await client.query(
              `SELECT "pointsCurrent" FROM "affiliatePointBalances"
                 WHERE "organizationId"=$1 AND "clientId"=$2`,
              [ctx.organizationId, clientId],
            );
            const pointsCurrent = Number(balRows[0]?.pointsCurrent ?? 0);

            if (deltaQty > 0) {
              if (absPoints > pointsCurrent) {
                await client.query("ROLLBACK");
                return NextResponse.json(
                  { error: "Insufficient affiliate points", required: absPoints, available: pointsCurrent },
                  { status: 400 },
                );
              }
              await client.query(
                `UPDATE "affiliatePointBalances"
                   SET "pointsCurrent"="pointsCurrent"-$1,
                       "pointsSpent"  ="pointsSpent"  +$1,
                       "updatedAt"=NOW()
                 WHERE "organizationId"=$2 AND "clientId"=$3`,
                [absPoints, ctx.organizationId, clientId],
              );
              await client.query(
                `INSERT INTO "affiliatePointLogs"
                   (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
                 VALUES (gen_random_uuid(),$1,$2,$3,'redeem','cart quantity update',NOW(),NOW())`,
                [ctx.organizationId, clientId, -absPoints],
              );
            } else {
              await client.query(
                `UPDATE "affiliatePointBalances"
                   SET "pointsCurrent"="pointsCurrent"+$1,
                       "pointsSpent"  =GREATEST("pointsSpent"-$1,0),
                       "updatedAt"=NOW()
                 WHERE "organizationId"=$2 AND "clientId"=$3`,
                [absPoints, ctx.organizationId, clientId],
              );
              await client.query(
                `INSERT INTO "affiliatePointLogs"
                   (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
                 VALUES (gen_random_uuid(),$1,$2,$3,'refund','cart quantity update',NOW(),NOW())`,
                [ctx.organizationId, clientId, absPoints],
              );
            }
          }
        }

        // inventory enforcement on increment (normal only)
        if (!isAffiliate && data.action === "add") {
          const inv = await readInventoryFast(client, data.productId, variationId);
          if (inv.manage && !inv.backorder && inv.stock !== null && newQty > inv.stock) {
            await client.query("ROLLBACK");
            return NextResponse.json(
              { error: `Only ${inv.stock} unit${inv.stock === 1 ? "" : "s"} available for this item.`, available: inv.stock },
              { status: 400 }
            );
          }
        }

        // tier pricing (normal only)
        let pricePerUnit = basePrice;
        if (!isAffiliate) {
          const tiers = (await tierPricing(ctx.organizationId)) as Tier[];
          const tier = pickTierForClient(tiers, country, data.productId, variationId, clientId);
          if (tier) {
            const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
            const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];
            const [{ rows: pSum }, { rows: vSum }] = await Promise.all([
              client.query(
                `SELECT COALESCE(SUM(quantity),0)::int AS qty
                   FROM "cartProducts"
                  WHERE "cartId"=$1 AND "productId" = ANY($2::text[])`,
                [cartId, tierProdIds],
              ),
              client.query(
                `SELECT COALESCE(SUM(quantity),0)::int AS qty
                   FROM "cartProducts"
                  WHERE "cartId"=$1 AND "variationId" = ANY($2::text[])`,
                [cartId, tierVarIds],
              ),
            ]);
            const qtyBefore = Number(pSum[0]?.qty ?? 0) + Number(vSum[0]?.qty ?? 0);
            const qtyAfter = qtyBefore - oldQty + newQty;
            pricePerUnit = getPriceForQuantity(tier.steps, qtyAfter) ?? basePrice;

            await client.query(
              `UPDATE "cartProducts"
                  SET "unitPrice"=$1,"updatedAt"=NOW()
                WHERE "cartId"=$2 AND "productId" = ANY($3::text[])`,
              [pricePerUnit, cartId, tierProdIds],
            );
            await client.query(
              `UPDATE "cartProducts"
                  SET "unitPrice"=$1,"updatedAt"=NOW()
                WHERE "cartId"=$2 AND "variationId" = ANY($3::text[])`,
              [pricePerUnit, cartId, tierVarIds],
            );
          }
        }

        // persist
        if (newQty === 0) {
          if (isAffiliate) {
            await client.query(
              `DELETE FROM "cartProducts"
                WHERE "cartId"=$1 AND "affiliateProductId"=$2 ${withVariation ? `AND "variationId"=$3` : ""}`,
              [cartId, data.productId, ...(withVariation ? [variationId] : [])]
            );
          } else {
            await client.query(
              `DELETE FROM "cartProducts"
                WHERE "cartId"=$1 AND "productId"=$2 ${withVariation ? `AND "variationId"=$3` : ""}`,
              [cartId, data.productId, ...(withVariation ? [variationId] : [])]
            );
          }
        } else {
          if (isAffiliate) {
            await client.query(
              `UPDATE "cartProducts"
                  SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
                WHERE "cartId"=$3 AND "affiliateProductId"=$4 ${withVariation ? `AND "variationId"=$5` : ""}`,
              [newQty, pricePerUnit, cartId, data.productId, ...(withVariation ? [variationId] : [])]
            );
          } else {
            await client.query(
              `UPDATE "cartProducts"
                  SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
                WHERE "cartId"=$3 AND "productId"=$4 ${withVariation ? `AND "variationId"=$5` : ""}`,
              [newQty, pricePerUnit, cartId, data.productId, ...(withVariation ? [variationId] : [])]
            );
          }
        }

        // stock adjust
        await adjustStock(client, data.productId, variationId, country, data.action === "add" ? -1 : 1);

        // update cart hash
        const { rows: linesForHash } = await client.query(
          `SELECT COALESCE("productId","affiliateProductId") AS pid, "variationId", quantity,"unitPrice"
             FROM "cartProducts" WHERE "cartId"=$1`,
          [cartId]
        );
        const newHash = crypto.createHash("sha256").update(JSON.stringify(linesForHash)).digest("hex");
        await client.query(
          `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
          [newHash, cartId]
        );

        await client.query("COMMIT");

        try { await emitCartToDisplay(cartId); } catch (e) { console.warn("[cd][update] emit failed", e); }

        // snapshot
        const [pRows, aRows] = await Promise.all([
          pool.query(
            `SELECT p.id,p.title,p.description,p.image,p.sku,
                    cp.quantity,cp."unitPrice",cp."variationId", false AS "isAffiliate"
               FROM products p
               JOIN "cartProducts" cp ON cp."productId"=p.id
              WHERE cp."cartId"=$1
              ORDER BY cp."createdAt"`,
            [cartId]
          ),
          pool.query(
            `SELECT ap.id,ap.title,ap.description,ap.image,ap.sku,
                    cp.quantity,cp."unitPrice",cp."variationId", true AS "isAffiliate"
               FROM "affiliateProducts" ap
               JOIN "cartProducts"     cp ON cp."affiliateProductId"=ap.id
              WHERE cp."cartId"=$1
              ORDER BY cp."createdAt"`,
            [cartId]
          ),
        ]);

        const lines = [...pRows.rows, ...aRows.rows].map((l: any) => ({
          ...l,
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.unitPrice) * l.quantity,
        }));

        return NextResponse.json({ lines }, { status: 200 });
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) return NextResponse.json({ error: err.errors }, { status: 400 });
      if (typeof err?.message === "string" && err.message.startsWith("No money price for")) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      console.error("[POS PATCH /pos/cart/:id/update-product]", err);
      return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
    }
  });
}
