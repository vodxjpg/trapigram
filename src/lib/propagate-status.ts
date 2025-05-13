import { Kysely } from "kysely";

export async function propagateStatusDeep(
  db: Kysely<any>,
  sourceProductIds: string[],
  newStatus: "published" | "draft",
) {
  /* --------------------------------------------------------- *
   * 1) UPDATE the *immediate* children of every source ID.    *
   * --------------------------------------------------------- */

  await db
    .updateTable("products")
    .set({ status: newStatus, updatedAt: new Date() })
    .where((eb) =>
      eb(
        "id",
        "in",
        // sub-query: all targetProductIds mapped from the current batch
        eb
          .selectFrom("sharedProductMapping")
          .select("targetProductId")
          .where("sourceProductId", "in", sourceProductIds),
      ),
    )
    .execute();

  /* --------------------------------------------------------- *
   * 2)  Grab those          children to cascade further.      *
   * --------------------------------------------------------- */

  const next = await db
    .selectFrom("sharedProductMapping")
    .select("targetProductId")
    .where("sourceProductId", "in", sourceProductIds)
    .execute();

  if (next.length) {
    await propagateStatusDeep(
      db,
      next.map((r) => r.targetProductId),
      newStatus,
    );
  }
}
