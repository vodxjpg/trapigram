import { pgPool as pool } from "@/lib/db";;



export async function computeMoneyPrice(product: any, country: string) {
  const sale = product.salePrice?.[country];
  const regular = product.regularPrice?.[country];
  const price = sale ?? regular;
  if (price == null)
    throw new Error(`No money price for ${country}`);
  return Number(price);
}

export async function computeAffiliatePointsPrice(
  product: any,
  clientLevelId: string | null,
  country: string
) {
  const key = clientLevelId ?? "default";
  const sale = product.salePoints?.[key]?.[country] ??
               product.salePoints?.default?.[country];
  const regular = product.regularPoints?.[key]?.[country] ??
                  product.regularPoints?.default?.[country];
  const price = sale ?? regular;
  if (price == null)
    throw new Error(`No points price for level ${key} in ${country}`);
  return Number(price);
}

export async function assertAffiliateLevelAllowed(
  clientLevelId: string | null,
  minLevelId: string | null
) {
  if (!minLevelId) return;
  if (!clientLevelId)
    throw new Error("Customer's level too low for this product");

  const { rows } = await pool.query(
    `SELECT id,"requiredPoints" FROM "affiliateLevels" WHERE id IN ($1,$2)`,
    [clientLevelId, minLevelId]
  );
  const min = rows.find(r => r.id === minLevelId);
  const cur = rows.find(r => r.id === clientLevelId);
  if (!min || !cur || cur.requiredPoints < min.requiredPoints)
    throw new Error("Customer's level too low for this product");
}

export async function resolveUnitPrice(
  productId: string,
  country: string,
  clientLevelId: string | null
): Promise<{ price: number; isAffiliate: boolean }> {
  const prod = await pool.query(`SELECT * FROM products WHERE id=$1`, [productId]);
  if (prod.rowCount) {
    return {
      price: await computeMoneyPrice(prod.rows[0], country),
      isAffiliate: false
    };
  }
  const aff = await pool.query(
    `SELECT * FROM "affiliateProducts" WHERE id=$1`, [productId]
  );
  if (!aff.rowCount) throw new Error("Product not found");
  await assertAffiliateLevelAllowed(clientLevelId, aff.rows[0].minLevelId);
  return {
    price: await computeAffiliatePointsPrice(aff.rows[0], clientLevelId, country),
    isAffiliate: true
  };
}
