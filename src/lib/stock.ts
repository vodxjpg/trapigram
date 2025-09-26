// src/lib/stock.ts — centralised inventory helper

import { pgPool as pool } from "@/lib/db";

// NOTE: if you have a Pool type elsewhere, import it;
// the code only needs an object with a `query` method.
export async function adjustStock(
  db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> },
  productId: string,
  variationId: string | null,
  country: string,
  delta: number,
): Promise<void> {
  if (!delta) return;

  /* 1) figure out product kind + stock rules */
  const { rows: metaRows } = await db.query(
    `SELECT 'product'::text AS kind, "manageStock","allowBackorders"
       FROM products WHERE id = $1
     UNION ALL
     SELECT 'affiliate'::text AS kind, "manageStock","allowBackorders"
       FROM "affiliateProducts" WHERE id = $1
     LIMIT 1`,
    [productId],
  );
  const meta = metaRows[0];
  if (!meta || !meta.manageStock) return;

  const isAffiliate = meta.kind === "affiliate";
  const col = isAffiliate ? `"affiliateProductId"` : `"productId"`;

  let newQty = 0
  let current

  if (variationId) {
    const { rows: wsRows } = await db.query(
      `SELECT id, quantity
       FROM "warehouseStock"
      WHERE "productId" = $1
        AND country = $2
        AND "variationId" = $3
      ORDER BY "createdAt" ASC
      LIMIT 1`,
      [productId, country, variationId],
    );

    current = wsRows[0];
    newQty = (current?.quantity ?? 0) + delta;

  } else {
    const { rows: wsRows } = await db.query(
      `SELECT id, quantity
       FROM "warehouseStock"
      WHERE ${col} = $1
        AND country = $2
      ORDER BY "createdAt" ASC
      LIMIT 1`,
      [productId, country],
    );

    current = wsRows[0];
    newQty = (current?.quantity ?? 0) + delta;
  }

  /* 3) oversell guard */
  if (delta < 0 && !meta.allowBackorders && newQty < 0) {
    throw new Error("Insufficient stock and back-orders are disabled");
  }
  if (newQty < 0) newQty = 0; // clamp; store backorders elsewhere if needed

  /* 4) write back using the correct FK column */
  if (current) {
    await db.query(
      `UPDATE "warehouseStock"
          SET quantity = $1,
              "updatedAt" = NOW()
        WHERE id = $2`,
      [newQty, current.id],
    );
  } else {
    // If you have NOT NULL org/tenant columns, pass real values here.
    await db.query(
      `INSERT INTO "warehouseStock"
       (id, "warehouseId", "productId", "affiliateProductId", "variationId",
        country, quantity, "organizationId", "tenantId",
        "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), NULL,
               $1,  -- productId
               $2,  -- affiliateProductId
               $3,  -- country
               $4,  -- quantity
               '', '', NOW(), NOW())`,
      [
        isAffiliate ? null : productId,
        isAffiliate ? productId : null,
        country,
        Math.max(0, newQty),
      ],
    );
  }
}
