// src/lib/pricing.ts
import { pgPool as pool } from "@/lib/db";

/* ─────────────────────────────────────────────────────────────
   Tiny in-module TTL cache (2 min)
   Keyed by productId|variationId|country|level
  ───────────────────────────────────────────────────────────── */
const TTL_MS = 120_000;
const priceCache = new Map<string, { at: number; val: { price: number; isAffiliate: boolean } }>();
const cacheKey = (p: string, v: string | null, c: string, lvl: string | null) =>
  `${p}|${v ?? "-"}|${c}|${lvl ?? "default"}`;

/**
 * Resolve the unit price for a product (money) or affiliate product (points).
 * - Single SQL round-trip
 * - Computes price in SQL using jsonb operators
 * - Validates affiliate min level in the same query
 */
export async function resolveUnitPrice(
  productId: string,
  variationId: string | null,
  country: string,
  clientLevelId: string | null,
): Promise<{ price: number; isAffiliate: boolean }> {
  const levelKey = clientLevelId ?? "default";
  const k = cacheKey(productId, variationId, country, levelKey);
  const now = Date.now();
  const hit = priceCache.get(k);
  if (hit && now - hit.at < TTL_MS) return hit.val;

  // One round-trip to fetch whichever entity exists + compute price and level guard
  const { rows } = await pool.query(
    `
    WITH p AS (
      SELECT id, "productType",
             salePrice::jsonb   AS p_sale,
             regularPrice::jsonb AS p_reg
      FROM products
      WHERE id = $1
    ),
    pv AS (
      SELECT id, "productId",
             salePrice::jsonb   AS v_sale,
             regularPrice::jsonb AS v_reg
      FROM "productVariations"
      WHERE id = $2 AND "productId" = $1
    ),
    a AS (
      SELECT id, "minLevelId",
             salePoints::jsonb   AS a_sale,
             regularPoints::jsonb AS a_reg
      FROM "affiliateProducts"
      WHERE id = $1
    ),
    cur AS (
      SELECT "requiredPoints" AS cur_req
      FROM "affiliateLevels"
      WHERE id = $3
    ),
    min AS (
      SELECT "requiredPoints" AS min_req
      FROM "affiliateLevels"
      WHERE id = (SELECT "minLevelId" FROM a)
    )
    SELECT
      (p.id IS NOT NULL)                 AS has_product,
      p."productType"                    AS product_type,
      (pv.id IS NOT NULL)                AS has_variation,
      /* Money price (use variation for variable, else product) */
      CASE
        WHEN p."productType" = 'variable' THEN
          COALESCE(NULLIF(pv.v_sale ->> $4, '0'), pv.v_reg ->> $4)::numeric
        ELSE
          COALESCE(NULLIF(p.p_sale  ->> $4, '0'), p.p_reg  ->> $4)::numeric
      END                                 AS money_price,
      (a.id IS NOT NULL)                  AS has_affiliate,
      /* Points price lookup with level key + default fallback */
      COALESCE(
        (a.a_sale #>> ARRAY[$5, $4])::numeric,
        (a.a_sale #>> ARRAY['default', $4])::numeric,
        (a.a_reg  #>> ARRAY[$5, $4])::numeric,
        (a.a_reg  #>> ARRAY['default', $4])::numeric
      )                                   AS points_price,
      cur.cur_req,
      min.min_req
    FROM p
    FULL OUTER JOIN a  ON TRUE
    LEFT JOIN pv ON TRUE
    LEFT JOIN cur ON TRUE
    LEFT JOIN min ON TRUE
    `,
    [productId, variationId, clientLevelId, country, levelKey],
  );

  const r = rows[0] ?? {};

  // Normal product path
  if (r.has_product) {
    if (r.product_type === "variable") {
      if (!variationId) throw new Error("variationId is required for variable products");
      if (!r.has_variation) throw new Error("Variation not found");
    }
    const priceNum = Number(r.money_price);
    if (!Number.isFinite(priceNum)) throw new Error(`No money price for ${country}`);
    const out = { price: priceNum, isAffiliate: false };
    priceCache.set(k, { at: now, val: out });
    return out;
  }

  // Affiliate product path
  if (r.has_affiliate) {
    // Level guard (only if a min level is set)
    const minReq = r.min_req == null ? null : Number(r.min_req);
    const curReq = r.cur_req == null ? null : Number(r.cur_req);
    if (minReq != null) {
      if (curReq == null || curReq < minReq) {
        throw new Error("Customer's level too low for this product");
      }
    }
    const pts = Number(r.points_price);
    if (!Number.isFinite(pts)) {
      throw new Error(`No points price for level ${levelKey} in ${country}`);
    }
    const out = { price: pts, isAffiliate: true };
    priceCache.set(k, { at: now, val: out });
    return out;
  }

  throw new Error("Product not found");
}
