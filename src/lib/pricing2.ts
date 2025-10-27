// src/lib/pricing.ts
import { pgPool as pool } from "@/lib/db";

/* ─────────────────────────────────────────────────────────────
   Tiny in-module TTL cache (2 min)
  ───────────────────────────────────────────────────────────── */
const TTL_MS = 120_000;
const cache = new Map<string, { at: number; val: { price: number; isAffiliate: boolean } }>();
const k = (p: string, v: string | null, c: string, lvl: string | null) =>
  `${p}|${v ?? "-"}|${c}|${lvl ?? "default"}`;

export async function resolveUnitPrice(
  productId: string,
  variationId: string | null,
  country: string,
  clientLevelId: string | null,
): Promise<{ price: number; isAffiliate: boolean }> {
  const levelKey = clientLevelId ?? "default";
  const key = k(productId, variationId, country, levelKey);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.val;

  const { rows } = await pool.query(
    `
    WITH p AS (
      SELECT id, "productType",
             "salePrice"::jsonb     AS p_sale,
             "regularPrice"::jsonb  AS p_reg
      FROM products
      WHERE id = $1
    ),
    pv AS (
      SELECT id, "productId",
             "salePrice"::jsonb     AS v_sale,
             "regularPrice"::jsonb  AS v_reg
      FROM "productVariations"
      WHERE id = $2 AND "productId" = $1
    ),
    a AS (
      SELECT id, "minLevelId",
             "salePoints"::jsonb     AS a_sale,
             "regularPoints"::jsonb  AS a_reg
      FROM "affiliateProducts"
      WHERE id = $1
    ),
    cur AS (
      SELECT "requiredPoints" AS cur_req
      FROM "affiliateLevels" WHERE id = $3
    ),
    min AS (
      SELECT "requiredPoints" AS min_req
      FROM "affiliateLevels" WHERE id = (SELECT "minLevelId" FROM a)
    )
    SELECT
      (p.id IS NOT NULL)                  AS has_product,
      p."productType"                     AS product_type,
      (pv.id IS NOT NULL)                 AS has_variation,

      CASE
        WHEN p.id IS NOT NULL AND p."productType" = 'variable' THEN
          COALESCE(NULLIF(pv.v_sale ->> $4, '0'), pv.v_reg ->> $4)::numeric
        WHEN p.id IS NOT NULL THEN
          COALESCE(NULLIF(p.p_sale  ->> $4, '0'), p.p_reg  ->> $4)::numeric
        ELSE NULL
      END                                  AS money_price,

      (a.id IS NOT NULL)                  AS has_affiliate,
      COALESCE(
        (a.a_sale #>> ARRAY[$5, $4])::numeric,
        (a.a_sale #>> ARRAY['default', $4])::numeric,
        (a.a_reg  #>> ARRAY[$5, $4])::numeric,
        (a.a_reg  #>> ARRAY['default', $4])::numeric
      )                                    AS points_price,

      cur.cur_req, min.min_req
    FROM p
    FULL OUTER JOIN a ON TRUE
    LEFT JOIN pv  ON TRUE
    LEFT JOIN cur ON TRUE
    LEFT JOIN min ON TRUE
    `,
    [productId, variationId, clientLevelId, country, levelKey],
  );

  const r = rows[0] ?? {};

  // Normal (money) product
  if (r.has_product) {
    if (r.product_type === "variable") {
      if (!variationId) throw new Error("variationId is required for variable products");
      if (!r.has_variation) throw new Error("Variation not found");
    }
    const priceNum = Number(r.money_price);
    if (!Number.isFinite(priceNum)) throw new Error(`No money price for ${country}`);
    const out = { price: priceNum, isAffiliate: false };
    cache.set(key, { at: now, val: out });
    return out;
  }

  // Affiliate product
  if (r.has_affiliate) {
    const minReq = r.min_req == null ? null : Number(r.min_req);
    const curReq = r.cur_req == null ? null : Number(r.cur_req);
    if (minReq != null && (curReq == null || curReq < minReq)) {
      throw new Error("Customer's level too low for this product");
    }
    const pts = Number(r.points_price);
    if (!Number.isFinite(pts)) {
      throw new Error(`No points price for level ${levelKey} in ${country}`);
    }
    const out = { price: pts, isAffiliate: true };
    cache.set(key, { at: now, val: out });
    return out;
  }

  throw new Error("Product not found");
}
