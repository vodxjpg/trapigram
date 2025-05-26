// src/lib/stock.ts — centralised inventory helper

import { Pool } from "pg";

/**
 * Reserve or release stock for one product in a single country.
 *
 * @param db        – any pg client/Pool with a `query` method
 * @param productId – UUID of the product we’re moving stock for
 * @param country   – 2‑letter country code (same key used in warehouseStock)
 * @param delta     – integers only
 *                    • negative → reserve  (take from available stock)
 *                    • positive → release (put back into available stock)
 *                    •   zero   → no‑op
 *
 * Throws when trying to reserve more than what’s available **and** the
 * product does **not** allow back‑orders.
 */
export async function adjustStock(
  db: Pick<Pool, "query">,
  productId: string,
  country: string,
  delta: number,
): Promise<void> {
  if (!delta) return; // nothing to do

  /* ------------------------------------------------------------------ */
  /* 1) product‑level stock rules                                        */
  /* ------------------------------------------------------------------ */
  const { rows: metaRows } = await db.query(
    `SELECT "manageStock"      AS "manageStock",
            "allowBackorders"  AS "allowBackorders"
       FROM products
      WHERE id = $1`,
    [productId],
  );

  const meta = metaRows[0];
  if (!meta || !meta.manageStock) return; // stock isn’t tracked

  /* ------------------------------------------------------------------ */
  /* 2) locate (any) warehouse line matching product + country          */
  /* ------------------------------------------------------------------ */
  const { rows: wsRows } = await db.query(
    `SELECT id, quantity
       FROM "warehouseStock"
      WHERE "productId" = $1
        AND country      = $2
      ORDER BY "createdAt" ASC
      LIMIT 1`,
    [productId, country],
  );

  const current = wsRows[0];
  const newQty  = (current?.quantity ?? 0) + delta;

  /* ------------------------------------------------------------------ */
  /* 3) over‑sell guard                                                 */
  /* ------------------------------------------------------------------ */
  if (delta < 0 && !meta.allowBackorders && newQty < 0) {
    throw new Error("Insufficient stock and back‑orders are disabled");
  }

  /* ------------------------------------------------------------------ */
  /* 4) write back                                                      */
  /* ------------------------------------------------------------------ */
  if (current) {
    // just update the existing row
    await db.query(
      `UPDATE "warehouseStock"
          SET quantity   = $1,
              "updatedAt" = NOW()
        WHERE id = $2`,
      [newQty, current.id],
    );
  } else {
    // first time we touch this (product,country) pair → insert stub row
    await db.query(
      `INSERT INTO "warehouseStock"
       (id, "warehouseId", "productId", country,
        quantity, "organizationId", "tenantId",
        "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), NULL, $1, $2, $3, '', '', NOW(), NOW())`,
      [productId, country, Math.max(0, newQty)],
    );
  }
}
