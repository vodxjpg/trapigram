// src/app/api/pos/cart/[id]/update-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import { getContext } from "@/lib/context";
import crypto from "crypto";
import { adjustStock } from "@/lib/stock";
import { resolveUnitPrice } from "@/lib/pricing";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";

async function withIdempotency(
  req: NextRequest,
  exec: () => Promise<{ status: number; body: any }>
): Promise<NextResponse> {
  const key = req.headers.get("Idempotency-Key");
  if (!key) {
    const r = await exec();
    return NextResponse.json(r.body, { status: r.status });
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
        return NextResponse.json(r.body, { status: r.status });
      }
      throw e;
    }
    const r = await exec();
    await c.query(
      `UPDATE idempotency SET status=$2, response=$3, "updatedAt"=NOW() WHERE key=$1`,
      [key, r.status, r.body]
    );
    await c.query("COMMIT");
    return NextResponse.json(r.body, { status: r.status });
  } catch (err) {
    await c.query("ROLLBACK");
    throw err;
  } finally {
    c.release();
  }
}

const BodySchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
  action: z.enum(["add", "subtract"]),
});

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

        // Use CART.country
        const { rows: cRows } = await client.query(
          `SELECT ca.country, cl."levelId", cl.id AS "clientId", cp.quantity
             FROM carts ca
             JOIN clients cl ON cl.id = ca."clientId"
             JOIN "cartProducts" cp ON cp."cartId" = ca.id
            WHERE ca.id = $1
              AND cp."productId" = $2
              ${withVariation ? `AND cp."variationId" = $3` : ""}`,
          [cartId, data.productId, ...(withVariation ? [variationId] : [])]
        );
        if (!cRows.length) {
          await client.query("ROLLBACK");
          return { status: 404, body: { error: "Cart item not found" } };
        }
        const { country, levelId, clientId, quantity: oldQty } = cRows[0];

        // Base price
        const { price: basePrice } = await resolveUnitPrice(
          data.productId,
          variationId,
          country,
          levelId ?? "default"
        );

        // New quantity
        const newQty = data.action === "add" ? oldQty + 1 : oldQty - 1;
        if (newQty < 0) {
          await client.query("ROLLBACK");
          return { status: 400, body: { error: "Quantity cannot be negative" } };
        }

        // Tier pricing
        let pricePerUnit = basePrice;
        const tiers = (await tierPricing(ctx.organizationId)) as Tier[];
        const tier = findTier(tiers, country, data.productId, variationId, clientId);
        if (tier) {
          const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
          const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];
          const { rows: sumRow } = await client.query(
            `SELECT COALESCE(SUM(quantity),0)::int AS qty
               FROM "cartProducts"
              WHERE "cartId"=$1
                AND ( ("productId" = ANY($2::text[]))
                      OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
            [cartId, tierProdIds, tierVarIds]
          );
          const qtyBefore = Number(sumRow[0].qty);
          const qtyAfter = qtyBefore - oldQty + newQty;
          pricePerUnit = getPriceForQuantity(tier.steps, qtyAfter) ?? basePrice;

          await client.query(
            `UPDATE "cartProducts"
                SET "unitPrice"=$1,"updatedAt"=NOW()
              WHERE "cartId"=$2
                AND ( ("productId" = ANY($3::text[]))
                      OR ("variationId" IS NOT NULL AND "variationId" = ANY($4::text[])) )`,
            [pricePerUnit, cartId, tierProdIds, tierVarIds]
          );
        }

        // Persist change / delete if zero
        if (newQty === 0) {
          await client.query(
            `DELETE FROM "cartProducts"
              WHERE "cartId"=$1 AND "productId"=$2
              ${withVariation ? `AND "variationId"=$3` : ""}`,
            [cartId, data.productId, ...(withVariation ? [variationId] : [])]
          );
        } else {
          await client.query(
            `UPDATE "cartProducts"
                SET quantity=$1,"unitPrice"=$2,"updatedAt"=NOW()
              WHERE "cartId"=$3 AND "productId"=$4
              ${withVariation ? `AND "variationId"=$5` : ""}`,
            [newQty, pricePerUnit, cartId, data.productId, ...(withVariation ? [variationId] : [])]
          );
        }

        // Stock adjust
        await adjustStock(client, data.productId, variationId, country, data.action === "add" ? -1 : 1);

        // Hash
        const { rows: linesForHash } = await client.query(
          `SELECT "productId","variationId",quantity,"unitPrice"
             FROM "cartProducts" WHERE "cartId"=$1`,
          [cartId]
        );
        const newHash = crypto.createHash("sha256").update(JSON.stringify(linesForHash)).digest("hex");
        await client.query(
          `UPDATE carts SET "cartUpdatedHash"=$1,"updatedAt"=NOW() WHERE id=$2`,
          [newHash, cartId]
        );

        await client.query("COMMIT");

        // Snapshot
        const { rows: pRows } = await pool.query(
          `SELECT p.id,p.title,p.description,p.image,p.sku,
                  cp.quantity,cp."unitPrice",cp."variationId"
             FROM products p
             JOIN "cartProducts" cp ON cp."productId"=p.id
            WHERE cp."cartId"=$1
            ORDER BY cp."createdAt"`,
          [cartId]
        );
        const lines = pRows.map((l: any) => ({
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
