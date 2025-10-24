// src/app/api/cart/[id]/remove-product/route.ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { pgPool as pool } from "@/lib/db";
import crypto from "crypto";
import { getContext } from "@/lib/context";
import { adjustStock } from "@/lib/stock";
import { tierPricing, getPriceForQuantity, type Tier } from "@/lib/tier-pricing";
import { resolveUnitPrice } from "@/lib/pricing";

/* ───────────────────────────────────────────────────────────── */

const cartProductSchema = z.object({
  productId: z.string(),
  variationId: z.string().nullable().optional(),
});

/**
 * DOs:
 *  - country match is case-insensitive
 *  - compare productId directly; only compare variationId when present
 *    (previously it compared p.variationId === productId by mistake)
 */

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

/** Compute a deterministic, non-null cart hash (hex) */
async function computeCartHash(cartId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT COALESCE("productId","affiliateProductId") AS pid,
            "variationId",
            quantity,"unitPrice"
       FROM "cartProducts"
      WHERE "cartId" = $1
      ORDER BY "createdAt"`,
    [cartId],
  );
  const json = JSON.stringify(rows ?? []);
  return crypto.createHash("sha256").update(json).digest("hex");
}

async function handleRemove(req: NextRequest, params: { id: string }) {
  const ctx = await getContext(req);
  if (ctx instanceof NextResponse) return ctx;
  const { id: cartId } = params;

  // Parse JSON body if present; else fallback to query params
  let parsed: z.infer<typeof cartProductSchema>;
  try {
    const body = await req.json().catch(() => ({}));
    parsed = cartProductSchema.parse(body);
  } catch {
    const url = new URL(req.url);
    const productId = url.searchParams.get("productId");
    const variationIdParam = url.searchParams.get("variationId");
    const variationId =
      variationIdParam === null || variationIdParam === "" ? null : variationIdParam;
    parsed = cartProductSchema.parse({ productId, variationId }); // will throw if productId missing
  }

  // normalize variationId: ensure string|null and treat empty as null
  const normVariationId: string | null =
    typeof parsed.variationId === "string" && parsed.variationId.trim().length > 0
      ? parsed.variationId
      : null;
  const withVariation = normVariationId !== null;

  try {

    const delSql = `
      DELETE FROM "cartProducts"
      WHERE "cartId" = $1
        AND ("productId" = $2 OR "affiliateProductId" = $2)
        ${withVariation ? `AND "variationId" = $3` : ""}
      RETURNING *
    `;
    const vals = withVariation ? [cartId, parsed.productId, normVariationId] : [cartId, parsed.productId];

    const result = await pool.query(delSql, vals);
    const deleted = result.rows[0];
    if (!deleted) {
      return NextResponse.json({ error: "Cart line not found" }, { status: 404 });
    }

    /* country + level + client lookup – used for stock + tier recompute and affiliate refunds */
    const { rows: cRows } = await pool.query(
      `SELECT cl.country, cl."levelId", ca."clientId"
         FROM carts ca
         JOIN clients cl ON cl.id = ca."clientId"
        WHERE ca.id = $1`,
      [cartId],
    );
    const country = cRows[0]?.country as string | undefined;
    const levelId = cRows[0]?.levelId as string | undefined;
    const clientId = cRows[0]?.clientId as string | undefined;

    /* 🔁 Refund affiliate points if the removed line was an affiliate reward */
    if (deleted.affiliateProductId) {
      // Points per unit are stored in unitPrice for affiliate lines
      const qty = Number(deleted.quantity ?? 0);
      const unitPts = Number(deleted.unitPrice ?? 0);
      const pointsRefund = qty > 0 && unitPts > 0 ? qty * unitPts : 0;

      if (pointsRefund > 0 && clientId) {
        // Add points back to balance and reduce pointsSpent (never below zero)
        await pool.query(
          `UPDATE "affiliatePointBalances"
              SET "pointsCurrent" = "pointsCurrent" + $1,
                  "pointsSpent"   = GREATEST("pointsSpent" - $1, 0),
                  "updatedAt"     = NOW()
            WHERE "organizationId" = $2
              AND "clientId"      = $3`,
          [pointsRefund, ctx.organizationId, clientId],
        );

        // Log the refund event for auditability
        await pool.query(
          `INSERT INTO "affiliatePointLogs"
             (id,"organizationId","clientId",points,action,description,"createdAt","updatedAt")
           VALUES (gen_random_uuid(),
                   $1,
                   $2,
                   $3,
                   'refund',
                   'remove from cart',
                   NOW(), NOW())`,
          [ctx.organizationId, clientId, pointsRefund],
        );
      }
    }

    /* Stock release */
    const releasedQty = Number(deleted.quantity ?? 0);
    if (releasedQty && country) {
      await adjustStock(pool as any, parsed.productId, normVariationId, country, +releasedQty);
    }

    /* Tier-pricing re-evaluation (normal products only) */
    if (!deleted.affiliateProductId && country && levelId) {
      const tiers = (await tierPricing(ctx.organizationId)) as Tier[];
      const tier = pickTierForClient(tiers, country, deleted.productId, normVariationId, clientId);

      if (tier) {
        const tierProdIds = tier.products.map((p) => p.productId).filter(Boolean) as string[];
        const tierVarIds = tier.products.map((p) => p.variationId).filter(Boolean) as string[];

        // Combined qty of all tier products left in the cart
        const { rows: qRows } = await pool.query(
          `SELECT COALESCE(SUM(quantity),0)::int AS qty
             FROM "cartProducts"
            WHERE "cartId" = $1
              AND ( ("productId" = ANY($2::text[]))
                    OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
          [cartId, tierProdIds, tierVarIds],
        );
        const qtyAfter = Number(qRows[0]?.qty ?? 0);

        const newUnit = getPriceForQuantity(tier.steps, qtyAfter);

        if (newUnit === null) {
          // Below first tier → fall back to each product's *base* price (per line, honoring variation)
          const { rows: lines } = await pool.query(
            `SELECT id,"productId","variationId"
               FROM "cartProducts"
              WHERE "cartId" = $1
                            AND ( ("productId" = ANY($2::text[]))
                      OR ("variationId" IS NOT NULL AND "variationId" = ANY($3::text[])) )`,
            [cartId, tierProdIds, tierVarIds],
          );

          for (const line of lines) {
            const { price } = await resolveUnitPrice(
              line.productId,
              (typeof line.variationId === "string" && line.variationId.trim().length > 0) ? line.variationId : null,
              country,
              levelId,
            );
            await pool.query(
              `UPDATE "cartProducts"
                  SET "unitPrice" = $1, "updatedAt" = NOW()
                WHERE id = $2`,
              [price, line.id],
            );
          }
        } else {
          // Still inside a tier → apply same price for all tier products in the cart
          await pool.query(
            `UPDATE "cartProducts"
                  SET "unitPrice" = $1, "updatedAt" = NOW()
                WHERE "cartId" = $2
                  AND (
                    ("productId" = ANY($3::text[]))
                    OR ("variationId" IS NOT NULL AND "variationId" = ANY($4::text[]))
                  )`,
            [newUnit, cartId, tierProdIds, tierVarIds],
          );
        }
      }
    }

    /* Recompute & persist cart hash (always non-null) */
    const newHash = await computeCartHash(cartId);
    await pool.query(
      `UPDATE carts
          SET "cartUpdatedHash" = $1,
              "updatedAt"       = NOW()
        WHERE id = $2`,
      [newHash, cartId],
    );

    return NextResponse.json(deleted, { status: 200 });
  } catch (err: any) {
    console.error("[DELETE /api/cart/:id/remove-product]", err);
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.errors }, { status: 400 });
    }
    return NextResponse.json({ error: err.message ?? "Internal server error" }, { status: 500 });
  }
}

/* Accept both DELETE and POST for back-compat */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = await params;
  return handleRemove(req, p);
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const p = await params;
  return handleRemove(req, p);
}
