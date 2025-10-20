// src/lib/pricing.ts
import { pgPool as pool } from "@/lib/db";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function parseMap<T extends object>(m: any): T {
  if (!m) return {} as T;
  if (typeof m === "string") {
    try {
      return JSON.parse(m) as T;
    } catch {
      return {} as T;
    }
  }
  return (m || {}) as T;
}

/* ------------------------------------------------------------------ */
/* Money pricing (normal products)                                     */
/* ------------------------------------------------------------------ */

export async function computeMoneyPrice(product: any, country: string) {
  const sale = parseMap<Record<string, number>>(product.salePrice)[country];
  const regular = parseMap<Record<string, number>>(product.regularPrice)[country];
  const price = sale === undefined || sale === 0 ? regular : sale;
  if (price == null) {
    throw new Error(`No money price for ${country}`);
  }
  return Number(price);
}

/* ------------------------------------------------------------------ */
/* Affiliate points pricing                                            */
/* ------------------------------------------------------------------ */

export async function computeAffiliatePointsPrice(
  product: any,
  clientLevelId: string | null,
  country: string,
) {
  const key = clientLevelId ?? "default";

  const salePoints = parseMap<Record<string, Record<string, number>>>(product.salePoints);
  const regularPoints = parseMap<Record<string, Record<string, number>>>(product.regularPoints);

  const price =
    salePoints?.[key]?.[country] ??
    salePoints?.default?.[country] ??
    regularPoints?.[key]?.[country] ??
    regularPoints?.default?.[country];

  if (price == null) {
    throw new Error(`No points price for level ${key} in ${country}`);
  }
  return Number(price);
}

/* ------------------------------------------------------------------ */
/* Affiliate level guard                                               */
/* ------------------------------------------------------------------ */

export async function assertAffiliateLevelAllowed(
  clientLevelId: string | null,
  minLevelId: string | null,
) {
  if (!minLevelId) return;
  if (!clientLevelId) {
    throw new Error("Customer's level too low for this product");
  }

  const { rows } = await pool.query(
    `SELECT id,"requiredPoints" FROM "affiliateLevels" WHERE id IN ($1,$2)`,
    [clientLevelId, minLevelId],
  );

  const min = rows.find((r: any) => r.id === minLevelId);
  const cur = rows.find((r: any) => r.id === clientLevelId);

  if (!min || !cur || cur.requiredPoints < min.requiredPoints) {
    throw new Error("Customer's level too low for this product");
  }
}

/* ------------------------------------------------------------------ */
/* Resolve unit price (normal or affiliate)                            */
/* ------------------------------------------------------------------ */

export async function resolveUnitPrice(
  productId: string,
  variationId: string | null,
  country: string,
  clientLevelId: string | null,
): Promise<{ price: number; isAffiliate: boolean }> {
  // 1) Try normal product
  const prod = await pool.query(
    `SELECT id,"productType","regularPrice","salePrice" FROM products WHERE id=$1`,
    [productId],
  );

  if (prod.rowCount) {
    const row = prod.rows[0] as {
      id: string;
      productType: "simple" | "variable";
      regularPrice: any;
      salePrice: any;
    };

    if (row.productType === "variable") {
      if (!variationId) {
        throw new Error("variationId is required for variable products");
      }
      const v = await pool.query(
        `SELECT "regularPrice","salePrice"
           FROM "productVariations"
          WHERE id=$1 AND "productId"=$2`,
        [variationId, productId],
      );
      if (!v.rowCount) {
        throw new Error("Variation not found");
      }

      const priced = {
        ...row,
        regularPrice: v.rows[0].regularPrice,
        salePrice: v.rows[0].salePrice,
      };

      return {
        price: await computeMoneyPrice(priced, country),
        isAffiliate: false,
      };
    }

    // simple product
    return {
      price: await computeMoneyPrice(row, country),
      isAffiliate: false,
    };
  }

  // 2) Fallback to affiliate product
  const aff = await pool.query(
    `SELECT id,"minLevelId","regularPoints","salePoints"
       FROM "affiliateProducts"
      WHERE id=$1`,
    [productId],
  );

  if (!aff.rowCount) {
    throw new Error("Product not found");
  }

  await assertAffiliateLevelAllowed(clientLevelId, aff.rows[0].minLevelId);

  return {
    price: await computeAffiliatePointsPrice(aff.rows[0], clientLevelId, country),
    isAffiliate: true,
  };
}
