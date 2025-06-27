// src/app/api/warehouses/sync/route.ts
export const runtime = "nodejs";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

/* ────────────────────────────────────────────────────────────────────────── */
/* helpers                                                                   */
/* ────────────────────────────────────────────────────────────────────────── */
const requestSchema = z.object({
  shareLinkId: z.string(),
  warehouseId: z.string(),
});

function generateId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
}

type ShareProfile = {
  wholeProduct: boolean;
  variationIds: Set<string>;
};

/* ────────────────────────────────────────────────────────────────────────── */
/* POST                                                                      */
/* ────────────────────────────────────────────────────────────────────────── */
export async function POST(req: NextRequest) {
  try {
    /* -------------------------------------------------- auth / prelims --- */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
    const userId               = session.user.id;
    const activeOrganizationId = session.session.activeOrganizationId;

    const body   = await req.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json({ error: parsed.error.errors }, { status: 400 });
    const { shareLinkId, warehouseId } = parsed.data;

    /* -------------------------------------------------- share-link ------- */
    const shareLink = await db
      .selectFrom("warehouseShareLink")
      .innerJoin("warehouse", "warehouse.id", "warehouseShareLink.warehouseId")
      .select([
        "warehouseShareLink.id",
        "warehouseShareLink.warehouseId",
        "warehouseShareLink.creatorUserId",
        "warehouseShareLink.status",
        "warehouse.countries",
      ])
      .where("warehouseShareLink.id", "=", shareLinkId)
      .where("warehouseShareLink.status", "=", "active")
      .executeTakeFirst();

    if (!shareLink)
      return NextResponse.json({ error: "Share link not found or inactive" }, { status: 404 });

    /* Only enforce recipient-check for non-owners */
    if (userId !== shareLink.creatorUserId) {
      const recipient = await db
        .selectFrom("warehouseShareRecipient")
        .select("id")
        .where("shareLinkId", "=", shareLinkId)
        .where("recipientUserId", "=", userId)
        .executeTakeFirst();
      if (!recipient)
        return NextResponse.json({ error: "You are not a recipient of this share link" }, { status: 403 });
    }

    // record recipient's target warehouse (harmless no-op if owner)
    await db
      .updateTable("warehouseShareRecipient")
      .set({ targetWarehouseId: warehouseId, updatedAt: new Date() })
      .where("shareLinkId", "=", shareLinkId)
      .where("recipientUserId", "=", userId)
      .execute();

    /* -------------------------------------------------- target warehouse-- */
    const targetWarehouse = await db
      .selectFrom("warehouse")
      .select(["id", "tenantId", "countries", "organizationId"])
      .where("id", "=", warehouseId)
      .executeTakeFirst();
    if (!targetWarehouse)
      return NextResponse.json({ error: "Target warehouse not found" }, { status: 404 });

    /* Only enforce ownership for non-owners */
    if (userId !== shareLink.creatorUserId) {
      const tenant = await db
        .selectFrom("tenant")
        .select("id")
        .where("ownerUserId", "=", userId)
        .executeTakeFirst();
      if (!tenant || tenant.id !== targetWarehouse.tenantId)
        return NextResponse.json({ error: "Unauthorized: You do not own this warehouse" }, { status: 403 });
    }

    /* resolve organisation id */
    let warehouseOrgs: string[] = [];
    if (Array.isArray(targetWarehouse.organizationId)) {
      warehouseOrgs = targetWarehouse.organizationId;
    } else if (typeof targetWarehouse.organizationId === "string") {
      try {
        const tmp = JSON.parse(targetWarehouse.organizationId);
        warehouseOrgs = Array.isArray(tmp) ? tmp : [targetWarehouse.organizationId];
      } catch {
        warehouseOrgs = [targetWarehouse.organizationId];
      }
    }
    if (!warehouseOrgs.length)
      return NextResponse.json({ error: "Target warehouse is not linked to an organization" }, { status: 400 });

    const organizationId =
      activeOrganizationId && warehouseOrgs.includes(activeOrganizationId)
        ? activeOrganizationId
        : warehouseOrgs[0];

    const orgExists = await db
      .selectFrom("organization")
      .select("id")
      .where("id", "=", organizationId)
      .executeTakeFirst();
    if (!orgExists)
      return NextResponse.json({ error: "Invalid organizationId" }, { status: 400 });

    /* -------------------------------------------------- shared products -- */
    const sharedProducts = await db
      .selectFrom("sharedProduct")
      .select(["productId", "variationId", "cost"])
      .where("shareLinkId", "=", shareLinkId)
      .execute();

    /* build per-product share profile */
    const shareProfile = new Map<string, ShareProfile>();
    for (const sp of sharedProducts) {
      if (!shareProfile.has(sp.productId))
        shareProfile.set(sp.productId, { wholeProduct: false, variationIds: new Set() });
      const p = shareProfile.get(sp.productId)!;
      if (sp.variationId === null) p.wholeProduct = true;
      else                         p.variationIds.add(sp.variationId);
    }

    const srcCountries    = JSON.parse(shareLink.countries)       as string[];
    const targetCountries = JSON.parse(targetWarehouse.countries) as string[];
    for (const sp of sharedProducts) {
      for (const c of Object.keys(sp.cost ?? {})) {
        if (!targetCountries.includes(c))
          return NextResponse.json({ error: `Target warehouse does not support ${c}` }, { status: 400 });
        if (!srcCountries.includes(c))
          return NextResponse.json({ error: `Country ${c} not supported by shared warehouse` }, { status: 400 });
      }
    }

    /* maps */
    const productIdMap   = new Map<string, string>(); // src → tgt
    const variationIdMap = new Map<string, string>(); // src → tgt

    /* ──────────────────────────────────────────────────────────────────── */
    /* SYNC LOOP (per shared product or variation)                         */
    /* ──────────────────────────────────────────────────────────────────── */
    for (const sp of sharedProducts) {
      /* ---------- ensure target product exists ------------------------ */
      let targetProductId: string;
      if (productIdMap.has(sp.productId)) {
        targetProductId = productIdMap.get(sp.productId)!;
      } else {
        /* reuse mapping in any share-link */
        const reuse = await db
          .selectFrom("sharedProductMapping")
          .innerJoin("products", "products.id", "sharedProductMapping.targetProductId")
          .select("sharedProductMapping.targetProductId")
          .where("sharedProductMapping.sourceProductId", "=", sp.productId)
          .where("products.tenantId", "=", targetWarehouse.tenantId)
          .executeTakeFirst();

        if (reuse) {
          targetProductId = reuse.targetProductId;
        } else {
          /* maybe product already created manually in tenant */
          const already = await db
            .selectFrom("products")
            .select("id")
            .where("id", "=", sp.productId)
            .where("tenantId", "=", targetWarehouse.tenantId)
            .executeTakeFirst();
          if (already) {
            targetProductId = already.id;
          } else {
            /* ---------- create product copy --------------------------- */
            targetProductId = generateId("PROD");

            const srcProd = await db
              .selectFrom("products")
              .select([
                "title", "sku", "status", "productType", "regularPrice", "salePrice",
                "allowBackorders", "manageStock", "stockStatus", "description", "image",
              ])
              .where("id", "=", sp.productId)
              .executeTakeFirst();
            if (!srcProd)
              return NextResponse.json({ error: `Source product ${sp.productId} not found` }, { status: 404 });

                      // generate new SKU by replacing ORG- with SHD- (leave other SKUs intact)
                      const suffix = srcProd.sku.startsWith("ORG-")
                        ? srcProd.sku.slice("ORG-".length)
                        : srcProd.sku;
                      let newSku = `SHD-${suffix}`;
            // ensure uniqueness if collision
            while (
              await db.selectFrom("products").select("id").where("sku", "=", newSku).executeTakeFirst()
            ) {
              newSku = `SHD-${suffix}-${Math.random().toString(36).substring(2, 4)}`;
            }

            await db.insertInto("products").values({
              id:              targetProductId,
              organizationId,
              tenantId:        targetWarehouse.tenantId,
              title:           srcProd.title,
              sku:             newSku,
              status:          srcProd.status,
              productType:     srcProd.productType,
              regularPrice:    srcProd.regularPrice,
              salePrice:       srcProd.salePrice,
              cost:            {},     // costs patched later per-country
              allowBackorders: srcProd.allowBackorders,
              manageStock:     srcProd.manageStock,
              stockStatus:     srcProd.manageStock ? "managed" : "unmanaged",
              description:     srcProd.description,
              image:           srcProd.image,
              createdAt:       new Date(),
              updatedAt:       new Date(),
            }).execute();

            /* ----------- categories copy ----------------------------- */
            const srcCats = await db
              .selectFrom("productCategory")
              .innerJoin("productCategories", "productCategories.id", "productCategory.categoryId")
              .select(["productCategories.id", "productCategories.name", "productCategories.slug"])
              .where("productCategory.productId", "=", sp.productId)
              .execute();
            for (const cat of srcCats) {
              let tgtCat = await db
                .selectFrom("productCategories")
                .select("id")
                .where("organizationId", "=", organizationId)
                .where("slug", "=", cat.slug)
                .executeTakeFirst();
              if (!tgtCat) {
                tgtCat = { id: generateId("CAT") };
                await db.insertInto("productCategories").values({
                  id:          tgtCat.id,
                  name:        cat.name,
                  slug:        cat.slug,
                  image:       null,
                  order:       0,
                  organizationId,
                  parentId:    null,
                  createdAt:   new Date(),
                  updatedAt:   new Date(),
                }).execute();
              }
              await db.insertInto("productCategory").values({
                productId:  targetProductId,
                categoryId: tgtCat.id,
              }).execute();
            }

            /* ----------- attributes + terms copy --------------------- */
            const srcAttrRows = await db
              .selectFrom("productAttributeValues")
              .innerJoin("productAttributes", "productAttributes.id", "productAttributeValues.attributeId")
              .innerJoin("productAttributeTerms", "productAttributeTerms.id", "productAttributeValues.termId")
              .select([
                "productAttributeValues.attributeId",
                "productAttributes.slug as attrSlug",
                "productAttributeTerms.id as termId",
                "productAttributeTerms.slug as termSlug",
                "productAttributeTerms.name as termName",
              ])
              .where("productAttributeValues.productId", "=", sp.productId)
              .execute();

            const attrMap = new Map<string, string>(); // srcAttrId ➜ tgtAttrId
            const termMap = new Map<string, string>(); // srcTermId ➜ tgtTermId

            for (const row of srcAttrRows) {
              /* attribute */  
              if (!attrMap.has(row.attributeId)) {
                let tgtAttr = await db
                  .selectFrom("productAttributes")
                  .select("id")
                  .where("organizationId", "=", organizationId)
                  .where("slug", "=", row.attrSlug)
                  .executeTakeFirst();
                if (!tgtAttr) {
                  tgtAttr = { id: generateId("ATTR") };
                  await db.insertInto("productAttributes").values({
                    id:          tgtAttr.id,
                    name:        row.attrSlug,
                    slug:        row.attrSlug,
                    organizationId,
                    createdAt:   new Date(),
                    updatedAt:   new Date(),
                  }).execute();
                }
                attrMap.set(row.attributeId, tgtAttr.id);
              }

              /* term */
              const tgtAttrId = attrMap.get(row.attributeId)!;
              if (!termMap.has(row.termId)) {
                let tgtTerm = await db
                  .selectFrom("productAttributeTerms")
                  .select("id")
                  .where("attributeId", "=", tgtAttrId)
                  .where("organizationId", "=", organizationId)
                  .where("slug", "=", row.termSlug)
                  .executeTakeFirst();
                if (!tgtTerm) {
                  tgtTerm = { id: generateId("TERM") };
                  await db.insertInto("productAttributeTerms").values({
                    id:          tgtTerm.id,
                    attributeId: tgtAttrId,
                    name:        row.termName,
                    slug:        row.termSlug,
                    organizationId,
                    createdAt:   new Date(),
                    updatedAt:   new Date(),
                  }).execute();
                }
                termMap.set(row.termId, tgtTerm.id);

                /* link product to term */
                await db.insertInto("productAttributeValues").values({
                  productId:   targetProductId,
                  attributeId: tgtAttrId,
                  termId:      tgtTerm.id,
                }).execute();
              }
            }
            /* ----------- variations copy (variable only) -------------- */
            if (srcProd.productType === "variable") {
              const profile = shareProfile.get(sp.productId)!;
              let varQuery = db
                .selectFrom("productVariations")
                .selectAll()
                .where("productId", "=", sp.productId);

              if (!profile.wholeProduct) {
                /* only requested variationIds */
                varQuery = varQuery.where("id", "in", [...profile.variationIds]);
              }

              const srcVars = await varQuery.execute();

              for (const v of srcVars) {
                /* map attributes */
                const srcAttrs = typeof v.attributes === "string"
                  ? JSON.parse(v.attributes)
                  : v.attributes;
                const tgtAttrs: Record<string, string> = {};
                for (const [srcAttr, srcTerm] of Object.entries(srcAttrs)) {
                  const tgtAttr = attrMap.get(srcAttr);
                  const tgtTerm = termMap.get(srcTerm as string);
                  if (tgtAttr && tgtTerm) tgtAttrs[tgtAttr] = tgtTerm;
                }

                /* ensure uniqueness */
                const sameVar = await db
                  .selectFrom("productVariations")
                  .select("id")
                  .where("productId", "=", targetProductId)
                  .where("attributes", "=", JSON.stringify(tgtAttrs))
                  .executeTakeFirst();

                const targetVariationId = sameVar ? sameVar.id : generateId("VAR");
                variationIdMap.set(v.id, targetVariationId);

                if (!sameVar) {
                  // generate new variation SKU by replacing ORG- with SHD-
                const varSuffix = v.sku.startsWith("ORG-")
                  ? v.sku.slice("ORG-".length)
                  : v.sku;
                let newVarSku = `SHD-${varSuffix}`;
                  while (
                    await db
                      .selectFrom("productVariations")
                      .select("id")
                      .where("sku", "=", newVarSku)
                      .executeTakeFirst()
                  ) {
                    newVarSku = `SHD-${varSuffix}-${Math.random().toString(36).substring(2, 4)}`;
                  }

                  await db.insertInto("productVariations").values({
                    id:          targetVariationId,
                    productId:   targetProductId,
                    attributes:  JSON.stringify(tgtAttrs),
                    sku:         newVarSku,
                    image:       v.image,
                    regularPrice:v.regularPrice,
                    salePrice:   v.salePrice,
                    cost:        v.cost,
                    createdAt:   new Date(),
                    updatedAt:   new Date(),
                  }).execute();
                }

                /* global mapping (source ➜ target) */
                const hasGlobalMap = await db
                  .selectFrom("sharedVariationMapping")
                  .select("id")
                  .where("sourceVariationId", "=", v.id)
                  .where("targetVariationId", "=", targetVariationId)
                  .executeTakeFirst();
                if (!hasGlobalMap) {
                  await db.insertInto("sharedVariationMapping").values({
                    id:               generateId("SVM"),
                    shareLinkId,
                    sourceProductId:  sp.productId,
                    targetProductId,
                    sourceVariationId: v.id,
                    targetVariationId,
                    createdAt:        new Date(),
                    updatedAt:        new Date(),
                  }).execute();
                }
              }
            }
          }
        }

        productIdMap.set(sp.productId, targetProductId);

        /* ensure mapping row for this share-link */
        const linkMap = await db
          .selectFrom("sharedProductMapping")
          .select("id")
          .where("shareLinkId", "=", shareLinkId)
          .where("sourceProductId", "=", sp.productId)
          .where("targetProductId", "=", targetProductId)
          .executeTakeFirst();
        if (!linkMap) {
          await db.insertInto("sharedProductMapping").values({
            id: generateId("SPM"),
            shareLinkId,
            sourceProductId: sp.productId,
            targetProductId,
            createdAt: new Date(),
            updatedAt: new Date(),
          }).execute();
        }

        /* ---------- per-country cost patch --------------------------- */
        const cost = sp.cost as Record<string, number>;

        if (sp.variationId === null) {
          /* product-level override */
          const tgt = await db
            .selectFrom("products")
            .select("cost")
            .where("id", "=", targetProductId)
            .executeTakeFirst();
          const current =
            tgt?.cost && typeof tgt.cost === "string" ? JSON.parse(tgt.cost) : tgt?.cost || {};
          await db
            .updateTable("products")
            .set({ cost: { ...current, ...cost }, updatedAt: new Date() })
            .where("id", "=", targetProductId)
            .execute();
        } else {
          /* variation-specific override */
          let targetVariationId = variationIdMap.get(sp.variationId);
          if (!targetVariationId) {
            const map = await db
              .selectFrom("sharedVariationMapping")
              .select("targetVariationId")
              .where("shareLinkId", "=", shareLinkId)
              .where("sourceVariationId", "=", sp.variationId)
              .executeTakeFirst();
            targetVariationId = map?.targetVariationId;
          }
          if (targetVariationId) {
            const tgtVar = await db
              .selectFrom("productVariations")
              .select("cost")
              .where("id", "=", targetVariationId)
              .executeTakeFirst();
            const current =
              tgtVar?.cost && typeof tgtVar.cost === "string"
                ? JSON.parse(tgtVar.cost)
                : tgtVar?.cost || {};
            await db
              .updateTable("productVariations")
              .set({ cost: { ...current, ...cost }, updatedAt: new Date() })
              .where("id", "=", targetVariationId)
              .execute();
          } else {
            console.warn(`[SYNC] no variation mapping for ${sp.variationId}`);
          }
        }

        /* ---------- STOCK ------------------------------------------- */
        const srcStockRows = await db
        .selectFrom("warehouseStock")
        .select(["warehouseId", "country", "quantity", "variationId"])
        .where("productId", "=", sp.productId)
        .where("warehouseId", "=", shareLink.warehouseId)
        .execute();

      // Collect all source warehouse IDs (include the original one to avoid empty IN)
      const linkWarehouses = await db
        .selectFrom("warehouseShareRecipient")
        .innerJoin("warehouseShareLink", "warehouseShareLink.id", "warehouseShareRecipient.shareLinkId")
        .select("warehouseShareLink.warehouseId")
        .where("warehouseShareRecipient.recipientUserId", "=", userId)
        .execute();
      const srcWarehouseIds = linkWarehouses.map(w => w.warehouseId);
      if (!srcWarehouseIds.includes(shareLink.warehouseId)) {
        srcWarehouseIds.push(shareLink.warehouseId);
      }

      for (const row of srcStockRows) {
        const srcVarId = row.variationId;
        if (srcVarId && !variationIdMap.has(srcVarId)) continue; // unmapped variation

        const tgtVarId = srcVarId ? variationIdMap.get(srcVarId)! : null;

        let qtyQuery = db
          .selectFrom("warehouseStock")
          .select("quantity")
          .where("productId", "=", sp.productId)
          .where("country", "=", row.country)
          .where("warehouseId", "in", srcWarehouseIds);

        if (srcVarId) qtyQuery = qtyQuery.where("variationId", "=", srcVarId);
        else          qtyQuery = qtyQuery.where("variationId", "is", null);

        const qtyRows  = await qtyQuery.execute();
        const totalQty = qtyRows.reduce((sum, q) => sum + q.quantity, 0);

          /* upsert into target warehouse */
          let stockQ = db
            .selectFrom("warehouseStock")
            .select("id")
            .where("warehouseId", "=", targetWarehouse.id)
            .where("productId", "=", targetProductId)
            .where("country", "=", row.country);
          if (tgtVarId) stockQ = stockQ.where("variationId", "=", tgtVarId);
          else          stockQ = stockQ.where("variationId", "is", null);

          const existing = await stockQ.executeTakeFirst();
          if (existing) {
            await db
              .updateTable("warehouseStock")
              .set({ quantity: totalQty, updatedAt: new Date() })
              .where("id", "=", existing.id)
              .execute();
          } else {
            await db.insertInto("warehouseStock").values({
              id:             generateId("WS"),
              warehouseId:    targetWarehouse.id,
              productId:      targetProductId,
              variationId:    tgtVarId,
              country:        row.country,
              quantity:       totalQty,
              organizationId,
              tenantId:       targetWarehouse.tenantId,
              createdAt:      new Date(),
              updatedAt: new Date(),
            }).execute();
          }
        } /* end stock rows */
      } /* end product processing */
    }   /* end sync loop */

    /* -------------------------------------------------- response -------- */
    const syncedProducts = Array.from(productIdMap, ([src, tgt]) => ({
      sourceProductId: src,
      targetProductId: tgt,
    }));
    return NextResponse.json({ message: "Warehouse synced successfully", syncedProducts }, { status: 200 });
  } catch (err) {
    console.error("[POST /api/warehouses/sync] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
