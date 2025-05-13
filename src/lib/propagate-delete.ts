/* ------------------------------------------------------------------ */
/* propagateDeleteDeep – 1-level-per-pass version                      */
/* ------------------------------------------------------------------ */
export async function propagateDeleteDeep(
  db: DB,
  startProductIds: string[],
) {
  const queue = [...startProductIds];

  while (queue.length) {
    const srcId = queue.shift()!;

    /* 1. find direct children and queue them ---------------------- */
    const childIds = (await db
      .selectFrom("sharedProductMapping")
      .select("targetProductId")
      .where("sourceProductId", "=", srcId)
      .execute()).map(r => r.targetProductId);

    if (childIds.length) queue.push(...childIds);

    /* 2. break every FK **to** this srcId ------------------------- */
    await db.deleteFrom("sharedVariationMapping")
            .where("targetProductId", "=", srcId).execute();
    await db.deleteFrom("sharedProductMapping")
            .where("targetProductId", "=", srcId).execute();
    await db.deleteFrom("sharedProduct")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("cartProducts")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("tierPricingProducts")
            .where("productId", "=", srcId).execute();

    /* 3. break every FK **from** this srcId ----------------------- */
    await db.deleteFrom("sharedVariationMapping")
            .where("sourceProductId", "=", srcId).execute();
    await db.deleteFrom("sharedProductMapping")
            .where("sourceProductId", "=", srcId).execute();

    /* 4. wipe the srcId’s own rows (safe order) ------------------- */
    await db.deleteFrom("warehouseStock")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("productVariations")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("productCategory")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("productAttributeValues")
            .where("productId", "=", srcId).execute();
    await db.deleteFrom("products")
            .where("id", "=", srcId).execute();
  }
}
