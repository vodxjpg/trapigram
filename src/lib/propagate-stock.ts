// src/lib/propagate-stock.ts
import type { DB } from "@/lib/db";
import { Kysely } from "kysely";

export type StockUpdate = {
  productId: string;
  variationId: string | null;
  country: string;
  quantity: number;
};

export async function propagateStockDeep(
  db: Kysely<DB>,
  seeds: string[],
  generateId: (prefix: string) => string,
  maxDepth = 5,
): Promise<void> {
  const visited = new Set<string>();
  let frontier = seeds.slice();

  for (let depth = 0; frontier.length && depth < maxDepth; depth++) {
    const next: string[] = [];

    for (const productKey of frontier) {
      if (visited.has(productKey)) continue;
      visited.add(productKey);

      /* gather every (variation,country) pair with stock >0 */
      const stockRows = await db
        .selectFrom("warehouseStock")
        .select(["variationId", "country"])
        .where("productId", "=", productKey)
        .where("quantity", ">", 0)
        .execute();
      if (!stockRows.length) continue;

      const updates = stockRows.map<StockUpdate>((r) => ({
        productId: productKey,
        variationId: r.variationId,
        country: r.country,
        quantity: 0,
      }));

      /* find all mappings where this product is the source        */
      const sharedProducts = await db
        .selectFrom("sharedProduct")
        .select(["shareLinkId"])
        .where("productId", "=", productKey)
        .execute();
      if (!sharedProducts.length) continue;

      const mappings = await db
        .selectFrom("sharedProductMapping")
        .select(["targetProductId", "shareLinkId"])
        .where("sourceProductId", "=", productKey)
        .where("shareLinkId", "in", sharedProducts.map((sp) => sp.shareLinkId))
        .execute();

      const mapByTarget: Record<string, string[]> = {};
      mappings.forEach((m) => {
        (mapByTarget[m.targetProductId] ??= []).push(m.shareLinkId);
      });

      for (const [targetProductId, linkIds] of Object.entries(mapByTarget)) {
        /* tenant & warehouses of the recipient                      */
        const rec = await db
          .selectFrom("warehouseShareRecipient")
          .select("recipientUserId")
          .where("shareLinkId", "in", linkIds)
          .executeTakeFirst();
        if (!rec) continue;

        const tenant = await db
          .selectFrom("tenant")
          .select("id")
          .where("ownerUserId", "=", rec.recipientUserId)
          .executeTakeFirst();
        if (!tenant) continue;

        const warehouses = await db
          .selectFrom("warehouse")
          .select(["id", "tenantId", "organizationId"])   // ← org id added
          .where("tenantId", "=", tenant.id)
          .execute();
        if (!warehouses.length) continue;

        /* all source warehouses that feed this target product       */
        const sourceWhIds = await db
          .selectFrom("sharedProductMapping")
          .innerJoin(
            "warehouseShareLink",
            "warehouseShareLink.id",
            "sharedProductMapping.shareLinkId",
          )
          .select("warehouseShareLink.warehouseId")
          .where("sharedProductMapping.targetProductId", "=", targetProductId)
          .execute()
          .then((r) => r.map((x) => x.warehouseId));
        if (!sourceWhIds.length) continue;

        for (const upd of updates) {
          const { variationId, country } = upd;

          /* recompute total qty from all upstream source warehouses */
          let qtyQ = db
            .selectFrom("warehouseStock")
            .select("quantity")
            .where("productId", "=", productKey)
            .where("country", "=", country)
            .where("warehouseId", "in", sourceWhIds);

          qtyQ = variationId
            ? qtyQ.where("variationId", "=", variationId)
            : qtyQ.where("variationId", "is", null);

          const totalQty = (await qtyQ.execute())
            .reduce((s, r) => s + r.quantity, 0);

          /* map variation if present                                */
          let targetVariationId: string | null = null;
          if (variationId) {
            const vMap = await db
              .selectFrom("sharedVariationMapping")
              .select("targetVariationId")
              .where("shareLinkId", "in", linkIds)
              .where("sourceProductId", "=", productKey)
              .where("targetProductId", "=", targetProductId)
              .where("sourceVariationId", "=", variationId)
              .executeTakeFirst();
            if (!vMap) continue;
            targetVariationId = vMap.targetVariationId;
          }

          /* upsert into every warehouse of the recipient tenant     */
          for (const wh of warehouses) {
            let q = db
              .selectFrom("warehouseStock")
              .select("id")
              .where("warehouseId", "=", wh.id)
              .where("productId", "=", targetProductId)
              .where("country", "=", country);

            q = targetVariationId
              ? q.where("variationId", "=", targetVariationId)
              : q.where("variationId", "is", null);

            const existing = await q.executeTakeFirst();
            if (existing) {
              await db
                .updateTable("warehouseStock")
                .set({ quantity: totalQty, updatedAt: new Date() })
                .where("id", "=", existing.id)
                .execute();
            } else {
              await db
                .insertInto("warehouseStock")
                .values({
                  id: generateId("WS"),
                  warehouseId: wh.id,
                  productId: targetProductId,
                  variationId: targetVariationId,
                  country,
                  quantity: totalQty,
                  organizationId: wh.organizationId,   // ← use warehouse org
                  tenantId: wh.tenantId,
                  createdAt: new Date(),
                  updatedAt: new Date(),
                })
                .execute();
            }
          }
        }
        next.push(targetProductId); // queue for further depth
      }
    }
    frontier = next;
  }
}
