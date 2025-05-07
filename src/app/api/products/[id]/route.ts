  import type { NextRequest } from "next/server";
  import     { NextResponse } from "next/server";
  import { z } from "zod";
  import { db } from "@/lib/db";
  import { auth } from "@/lib/auth";
  import { v4 as uuidv4 } from "uuid";

  /* ------------------------------------------------------------------ */
  /* helper – merge regular/sale JSON objects ➜ { IT:{regular, sale}, …} */
  function mergePriceMaps(
    regular: Record<string, number> | null,
    sale: Record<string, number> | null,
  ) {
    const map: Record<string, { regular: number; sale: number | null }> = {};
    const reg = regular || {};
    const sal = sale || {};
    for (const [c, v] of Object.entries(reg)) map[c] = { regular: Number(v), sale: null };
    for (const [c, v] of Object.entries(sal))
      map[c] = { ...(map[c] || { regular: 0, sale: null }), sale: Number(v) };
    return map;
  }

  /* ------------------------------------------------------------------ */
  /* helper – split map ➜ {regularPrice, salePrice} (JSONB ready)       */
  const priceObj = z.object({ regular: z.number().min(0), sale: z.number().nullable() });
  const costMap = z.record(z.string(), z.number().min(0));

  function splitPrices(
    pr: Record<string, { regular: number; sale: number | null }>,
  ) {
    const regular: Record<string, number> = {};
    const sale: Record<string, number> = {};
    for (const [c, v] of Object.entries(pr)) {
      regular[c] = v.regular;
      if (v.sale != null) sale[c] = v.sale;
    }
    return {
      regularPrice: regular,
      salePrice: Object.keys(sale).length ? sale : null,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Helper to generate string-based IDs */
  function generateId(prefix: string): string {
    return `${prefix}-${Math.random().toString(36).substring(2, 10)}`;
  }

  /* ------------------------------------------------------------------ */
  /* Zod schema for PATCH                                               */
  /* ------------------------------------------------------------------ */
  const warehouseStockSchema = z.array(
    z.object({
      warehouseId: z.string(),
      productId: z.string(),
      variationId: z.string().nullable(),
      country: z.string(),
      quantity: z.number().min(0),
    }),
  );

  const variationPatchSchema = z.object({
    id: z.string(),
    attributes: z.record(z.string(), z.string()),
    sku: z.string(),
    image: z.string().nullable().optional(),
    prices: z.record(z.string(), priceObj),
    cost: costMap.optional(),
  });

  const productUpdateSchema = z.object({
    title: z.string().min(1, "Title is required").optional(),
    description: z.string().optional(),
    image: z.string().nullable().optional(),
    sku: z.string().min(1, "SKU is required").optional(),
    status: z.enum(["published", "draft"]).optional(),
    productType: z.enum(["simple", "variable"]).optional(),
    categories: z.array(z.string()).optional(),
    prices: z.record(z.string(), priceObj).optional(),
    cost: costMap.optional(),
    allowBackorders: z.boolean().optional(),
    manageStock: z.boolean().optional(),
    warehouseStock: warehouseStockSchema.optional(),
    attributes: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          terms: z.array(z.object({ id: z.string(), name: z.string() })),
          useForVariations: z.boolean(),
          selectedTerms: z.array(z.string()),
        }),
      )
      .optional(),
    variations: z.array(variationPatchSchema).optional(),
  });

  /* ================================================================== */
  /* GET                                                               */
  /* ================================================================== */
  export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    const { id } = await params;

    /* ---------- auth ------------------------------------------------ */
    const session = await auth.api.getSession({ headers: req.headers });
    if (!session)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = session.session.activeOrganizationId;
    if (!orgId)
      return NextResponse.json({ error: "No active organization" }, { status: 400 });

    /* ---------- fetch tenantId for user ---------------------------- */
    const tenant = await db
      .selectFrom("tenant")
      .select("id")
      .where("ownerUserId", "=", session.user.id)
      .executeTakeFirst();
    if (!tenant)
      return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
    const userTenantId = tenant.id;

     /* ---------- detect “shared copy” purely via mapping -------- */
     const mapping = await db
       .selectFrom("sharedProductMapping")
       .select("sourceProductId")
       .where("targetProductId", "=", id)
       .executeTakeFirst();
     const sourceProductId = mapping?.sourceProductId ?? null;
     const isShared = Boolean(sourceProductId);
     const actualProductId = id;
    /* ---------- product row ---------------------------------------- */
    const raw = await db
      .selectFrom("products")
      .selectAll()
      .where("id", "=", actualProductId)
      .where("organizationId", "=", orgId)
      .executeTakeFirst();
    if (!raw)
      return NextResponse.json({ error: "Product not found" }, { status: 404 });

    const tenantId = raw.tenantId;

    /* ---------- determine relevant warehouseIds -------------------- */
    let warehouseIds: string[] = [];
    if (sourceProductId) {
      // This is a shared product; fetch the target warehouse IDs for the current user
      const targetWarehouses = await db
        .selectFrom("warehouse")
        .select("id")
        .where("tenantId", "=", userTenantId)
        .execute();
      warehouseIds = targetWarehouses.map((w) => w.id);
      console.log(`[PRODUCT_GET] Target warehouse IDs for tenant ${userTenantId}:`, warehouseIds);
    } else {
      // Not a shared product, fetch all warehouses for the product's tenant
      const warehouses = await db
        .selectFrom("warehouse")
        .select("id")
        .where("tenantId", "=", tenantId)
        .execute();
      warehouseIds = warehouses.map((w) => w.id);
      console.log(`[PRODUCT_GET] Warehouse IDs for tenant ${tenantId}:`, warehouseIds);
    }

    /* ---------- stock data ----------------------------------------- */
    const stockRows = await db
      .selectFrom("warehouseStock")
      .select(["warehouseId", "country", "quantity", "variationId"])
      .where("productId", "=", actualProductId)
      .where("warehouseId", "in", warehouseIds)
      .execute();

    console.log(`[PRODUCT_GET] Stock rows for productId ${actualProductId}:`, stockRows);

    const stockData = stockRows
      .filter((row) => !row.variationId)
      .reduce((acc, row) => {
        if (!acc[row.warehouseId]) acc[row.warehouseId] = {};
        acc[row.warehouseId][row.country] = row.quantity;
        return acc;
      }, {} as Record<string, Record<string, number>>);

    /* ---------- categories ----------------------------------------- */
    const categoryRows = await db
      .selectFrom("productCategory")
      .innerJoin(
        "productCategories",
        "productCategories.id",
        "productCategory.categoryId",
      )
      .select(["productCategories.id"])
      .where("productCategory.productId", "=", actualProductId)
      .execute();
    const categories = categoryRows.map((r) => r.id);

    /* ---------- attributes ----------------------------------------- */
    const attrRows = await db
      .selectFrom("productAttributeValues")
      .innerJoin(
        "productAttributes",
        "productAttributes.id",
        "productAttributeValues.attributeId",
      )
      .innerJoin(
        "productAttributeTerms",
        "productAttributeTerms.id",
        "productAttributeValues.termId",
      )
      .select([
        "productAttributeValues.attributeId as id",
        "productAttributes.name as name",
        "productAttributeTerms.id as termId",
        "productAttributeTerms.name as termName",
      ])
      .where("productAttributeValues.productId", "=", actualProductId)
      .execute();
    const attributes = attrRows.reduce<any[]>((acc, row) => {
      let attr = acc.find((a) => a.id === row.id);
      if (!attr) {
        attr = {
          id: row.id,
          name: row.name,
          terms: [],
          selectedTerms: [],
          useForVariations: false,
        };
        acc.push(attr);
      }
      attr.terms.push({ id: row.termId, name: row.termName });
      attr.selectedTerms.push(row.termId);
      return acc;
    }, []);

    /* ---------- variations (if any) -------------------------------- */
    let variationsRaw: any[] = [];
    if (raw.productType === "variable") {
      variationsRaw = await db
        .selectFrom("productVariations")
        .selectAll()
        .where("productId", "=", actualProductId)
        .execute();
    }

    const cost =
      raw.cost && typeof raw.cost === "string" ? JSON.parse(raw.cost) : raw.cost ?? {};

    const variations = variationsRaw.map((v) => {
      const reg =
        v.regularPrice && typeof v.regularPrice === "string"
          ? JSON.parse(v.regularPrice)
          : v.regularPrice;
      const sal =
        v.salePrice && typeof v.salePrice === "string"
          ? JSON.parse(v.salePrice)
          : v.salePrice;
      const cost =
        typeof v.cost === "string" ? JSON.parse(v.cost) : v.cost ?? {};
      return {
        id: v.id,
        attributes: v.attributes,
        sku: v.sku,
        image: v.image,
        prices: mergePriceMaps(reg, sal),
        cost,
        stock: stockRows
          .filter((row) => row.variationId === v.id)
          .filter((row) => warehouseIds.includes(row.warehouseId))
          .reduce((acc, row) => {
            if (!acc[row.warehouseId]) acc[row.warehouseId] = {};
            acc[row.warehouseId][row.country] = row.quantity;
            return acc;
          }, {} as Record<string, Record<string, number>>),
      };
    });

    /* ---------- price parsing ------------------------------ */
    const reg =
      raw.regularPrice && typeof raw.regularPrice === "string"
        ? JSON.parse(raw.regularPrice)
        : raw.regularPrice;
    const sal =
      raw.salePrice && typeof raw.salePrice === "string"
        ? JSON.parse(raw.salePrice)
        : raw.salePrice;

    /* ---------- final product payload ------------------------------ */
    const product = {
      ...raw,
      prices: mergePriceMaps(reg, sal),
      cost,
      stockData,
      stockStatus: raw.manageStock ? "managed" : "unmanaged",
      categories,
      attributes: attributes.map((a) => ({
        ...a,
        useForVariations: raw.productType === "variable",
      })),
      variations,
    };

    return NextResponse.json(
         { product, shared: isShared },
         {
           status: 200,
           headers: {
             "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
           },
         }
       );
  }

  /* ================================================================== */
  /* PATCH                                                             */
  /* ================================================================== */
  export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    try {
      /* -------- authentication / boilerplate (unchanged) ---------- */
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session)
        return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
      const organizationId = session.session.activeOrganizationId;
      if (!organizationId)
        return NextResponse.json({ error: "No active organization" }, { status: 400 });

      const tenant = await db
        .selectFrom("tenant")
        .select(["id"])
        .where("ownerUserId", "=", session.user.id)
        .executeTakeFirst();
      if (!tenant)
        return NextResponse.json({ error: "No tenant found for user" }, { status: 404 });
      const tenantId = tenant.id;

      const { id } = await params;

      /* -------- detect shared copy (original var name) ----------- */
      const isSharedProduct = await db
        .selectFrom("sharedProductMapping")
        .select("targetProductId")
        .where("targetProductId", "=", id)
        .executeTakeFirst();

      /* -------- parse  validate incoming payload ------------ */
      const body = await req.json();
      let parsedUpdate;
      try {
        parsedUpdate = productUpdateSchema.parse(body);
      } catch (err) {
        if (err instanceof z.ZodError) {
          return NextResponse.json({ error: err.errors }, { status: 400 });
        }
        throw err;
      }

      /* ---- if shared, allow only prices & variation prices ------- */
      // inside your PATCH handler, replace the old `if (isSharedProduct)` block with this:

  if (isSharedProduct) {
    // figure out what the user tried to change
    const attempted = Object.keys(parsedUpdate);
    const allowed   = ["title", "description", "status", "prices", "variations", "categories"];
    const skipped   = attempted.filter((k) => !allowed.includes(k));

    // apply each allowed change
    const { title, description, prices, variations } = parsedUpdate;
    const { categories } = parsedUpdate;

    if (title) {
      await db
        .updateTable("products")
        .set({ title, updatedAt: new Date() })
        .where("id", "=", id)
        .execute();
    }

    if (description !== undefined) {
      await db
        .updateTable("products")
        .set({ description, updatedAt: new Date() })
        .where("id", "=", id)
        .execute();
    }

    if (prices) {
      const { regularPrice, salePrice } = splitPrices(prices);
      await db
        .updateTable("products")
        .set({ regularPrice, salePrice, updatedAt: new Date() })
        .where("id", "=", id)
        .execute();
    }

    if (variations) {
      // only update existing variations
      const existingVarRows = await db
        .selectFrom("productVariations")
        .select("id")
        .where("productId", "=", id)
        .execute();
      const existingIds = new Set(existingVarRows.map((v) => v.id));

      for (const v of variations) {
        if (!existingIds.has(v.id)) continue;
        const { regularPrice, salePrice } = splitPrices(v.prices);
        await db
          .updateTable("productVariations")
          .set({ regularPrice, salePrice, updatedAt: new Date() })
          .where("id", "=", v.id)
          .execute();
      }
    }

     // now handle categories on shared product
     if (categories) {
       // remove all existing categories for this shared item
       await db
         .deleteFrom("productCategory")
         .where("productId", "=", id)
         .execute();
       // insert the new ones
       for (const cid of categories) {
         await db
           .insertInto("productCategory")
           .values({ productId: id, categoryId: cid })
           .execute();
       }
     }

    // build the user message
    let message = "Shared product updated successfully.";
    if (skipped.length) {
      message = ` Note: the following field${skipped.length > 1 ? "s were" : " was"} skipped because shared products cannot be edited: ${skipped.join(", ")}.`;
    }

    return NextResponse.json({ message }, { status: 200 });
  }


      /* -------- preliminary FK / uniqueness checks (unchanged) ---- */
      const existingProduct = await db
        .selectFrom("products")
        .select("id")
        .where("id", "=", id)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      if (!existingProduct)
        return NextResponse.json({ error: "Product not found" }, { status: 404 });

      if (parsedUpdate.sku) {
        const conflict = await db
          .selectFrom("products")
          .select("id")
          .where("sku", "=", parsedUpdate.sku)
          .where("id", "!=", id)
          .where("organizationId", "=", organizationId)
          .executeTakeFirst();
        if (conflict)
          return NextResponse.json({ error: "SKU already exists" }, { status: 400 });
      }

      if (parsedUpdate.categories?.length) {
        const validIds = (
          await db.selectFrom("productCategories").select("id").where("organizationId", "=", organizationId).execute()
        ).map((c) => c.id);
        const bad = parsedUpdate.categories.filter((cid) => !validIds.includes(cid));
        if (bad.length)
          return NextResponse.json({ error: `Invalid category IDs: ${bad.join(", ")}` }, { status: 400 });
      }

      /* -------- build products update payload -------------------- */
      const updateCols: Record<string, any> = {
        title:            parsedUpdate.title,
        description:      parsedUpdate.description,
        image:            parsedUpdate.image,
        sku:              parsedUpdate.sku,
        status:           parsedUpdate.status,
        productType:      parsedUpdate.productType,
        allowBackorders:  parsedUpdate.allowBackorders,
        manageStock:      parsedUpdate.manageStock,
        stockStatus:      parsedUpdate.manageStock ? "managed" : "unmanaged",
        updatedAt:        new Date(),
      };

      if (parsedUpdate.prices) {
        const { regularPrice, salePrice } = splitPrices(parsedUpdate.prices);
        updateCols.regularPrice = regularPrice;
        updateCols.salePrice    = salePrice;
      }
      if (parsedUpdate.cost) updateCols.cost = parsedUpdate.cost;

      await db.updateTable("products").set(updateCols).where("id", "=", id).execute();

      /* -------- categories (unchanged) ---------------------------- */
      if (parsedUpdate.categories) {
        await db.deleteFrom("productCategory").where("productId", "=", id).execute();
        for (const cid of parsedUpdate.categories)
          await db.insertInto("productCategory").values({ productId: id, categoryId: cid }).execute();
      }

      /* -------- attributes (unchanged) ---------------------------- */
      if (parsedUpdate.attributes) {
        await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
        for (const a of parsedUpdate.attributes)
          for (const termId of a.selectedTerms)
            await db.insertInto("productAttributeValues").values({ productId: id, attributeId: a.id, termId }).execute();
      }

      /* ============================================================== */
      /*  **NEW** safe upsert for variations (variable products)        */
      /* ============================================================== */
      if (parsedUpdate.productType === "variable" && parsedUpdate.variations) {
        /* current variations in DB */
        const existingVarRows = await db
          .selectFrom("productVariations")
          .select("id")
          .where("productId", "=", id)
          .execute();
        const existingIds  = existingVarRows.map((v) => v.id);
        const incomingIds  = parsedUpdate.variations.map((v) => v.id);

        /* ---- handle deletions ------------------------------------ */
        const toDelete = existingIds.filter((vid) => !incomingIds.includes(vid));
        if (toDelete.length) {
          const stillReferenced = await db
            .selectFrom("sharedProduct")
            .select("variationId")
            .where("variationId", "in", toDelete)
            .execute();
          const blockedIds = stillReferenced.map((r) => r.variationId);

          const deletable = toDelete.filter((vid) => !blockedIds.includes(vid));
          if (deletable.length)
            await db.deleteFrom("productVariations").where("id", "in", deletable).execute();

          if (blockedIds.length) {
            return NextResponse.json(
              {
                error:
                  "Cannot delete variations because they are included in active warehouse share links. Remove them from those links first.",
              },
              { status: 409 },
            );
          }
        }

        /* ---- upsert incoming variations -------------------------- */
        for (const v of parsedUpdate.variations) {
          const { regularPrice, salePrice } = splitPrices(v.prices);
          const payload = {
            productId:   id,
            attributes:  JSON.stringify(v.attributes),
            sku:         v.sku,
            image:       v.image ?? null,
            regularPrice,
            salePrice,
            cost:        v.cost ?? {},
            updatedAt:   new Date(),
          };

          if (existingIds.includes(v.id)) {
            await db.updateTable("productVariations").set(payload).where("id", "=", v.id).execute();
          } else {
            await db
              .insertInto("productVariations")
              .values({ ...payload, id: v.id, createdAt: new Date() })
              .execute();
          }
        }
      }
      /* -------------------------------------------------------------- */
      /* warehouseStock                                              */
      /* -------------------------------------------------------------- */
      if (parsedUpdate.warehouseStock) {
        // Delete existing stock entries for this product (User A's warehouses)
        await db.deleteFrom("warehouseStock").where("productId", "=", id).execute();

        // Insert new stock entries for User A
        for (const entry of parsedUpdate.warehouseStock) {
          await db
            .insertInto("warehouseStock")
            .values({
              id: uuidv4(),
              warehouseId: entry.warehouseId,
              productId: entry.productId,
              variationId: entry.variationId,
              country: entry.country,
              quantity: entry.quantity,
              organizationId,
              tenantId,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .execute();
        }

        console.log(`[DEBUG_STOCK_UPDATE] Updated stock for productId: ${id} in User A's warehouses:`, parsedUpdate.warehouseStock);

        // Step 1: Find all share links that include this product
        const sharedProducts = await db
          .selectFrom("sharedProduct")
          .select(["id", "shareLinkId"])
          .where("productId", "=", id)
          .execute();

        if (sharedProducts.length === 0) {
          console.log(`[DEBUG_STOCK_UPDATE] No sharedProduct entries found for productId: ${id}`);
        } else {
          console.log(`[DEBUG_STOCK_UPDATE] Found ${sharedProducts.length} sharedProduct entries for productId: ${id}`, sharedProducts);

          // Step 2: Find all mappings for this product across all share links
          const mappings = await db
            .selectFrom("sharedProductMapping")
            .select(["id", "sourceProductId", "targetProductId", "shareLinkId"])
            .where("sourceProductId", "=", id)
            .where("shareLinkId", "in", sharedProducts.map(sp => sp.shareLinkId))
            .execute();

          if (mappings.length === 0) {
            console.log(`[DEBUG_STOCK_UPDATE] No mappings found for sourceProductId: ${id}`);
          } else {
            console.log(`[DEBUG_STOCK_UPDATE] Found ${mappings.length} mappings for sourceProductId: ${id}`, mappings);

            // Group mappings by targetProductId to process each unique target product
            const mappingsByTarget: Record<string, { sourceProductId: string; shareLinkId: string }[]> = {};
            for (const mapping of mappings) {
              if (!mappingsByTarget[mapping.targetProductId]) {
                mappingsByTarget[mapping.targetProductId] = [];
              }
              mappingsByTarget[mapping.targetProductId].push({
                sourceProductId: mapping.sourceProductId,
                shareLinkId: mapping.shareLinkId,
              });
            }

            console.log(`[DEBUG_STOCK_UPDATE] Grouped mappings by targetProductId:`, mappingsByTarget);

            // Step 3: Process each target product
            for (const [targetProductId, targetMappings] of Object.entries(mappingsByTarget)) {
              console.log(`[DEBUG_STOCK_UPDATE] Processing targetProductId: ${targetProductId}`);

              // Find the recipient user ID from the share link
              const shareLinkRecipient = await db
                .selectFrom("warehouseShareRecipient")
                .select("recipientUserId")
                .where("shareLinkId", "in", targetMappings.map(m => m.shareLinkId))
                .executeTakeFirst();

              if (!shareLinkRecipient) {
                console.log(`[DEBUG_STOCK_UPDATE] No recipient found for shareLinkIds: ${targetMappings.map(m => m.shareLinkId).join(", ")}`);
                continue;
              }

              const recipientUserId = shareLinkRecipient.recipientUserId;

              // Fetch the recipient's tenant ID
              const recipientTenant = await db
                .selectFrom("tenant")
                .select("id")
                .where("ownerUserId", "=", recipientUserId)
                .executeTakeFirst();

              if (!recipientTenant) {
                console.log(`[DEBUG_STOCK_UPDATE] No tenant found for recipientUserId: ${recipientUserId}`);
                continue;
              }

              const recipientTenantId = recipientTenant.id;

              // Fetch all target warehouses for the recipient's tenant
              const targetWarehouses = await db
                .selectFrom("warehouse")
                .select(["id", "tenantId"])
                .where("tenantId", "=", recipientTenantId)
                .execute();

              if (targetWarehouses.length === 0) {
                console.log(`[DEBUG_STOCK_UPDATE] No target warehouses found for targetProductId: ${targetProductId} in tenant ${recipientTenantId}`);
                continue;
              }

              console.log(`[DEBUG_STOCK_UPDATE] Found ${targetWarehouses.length} target warehouses for targetProductId: ${targetProductId} in tenant ${recipientTenantId}`, targetWarehouses);

              // Step 4: Fetch all source warehouses linked to the share links (User A's warehouses)
              const sourceWarehouses = await db
                .selectFrom("warehouseShareLink")
                .select(["warehouseShareLink.warehouseId"])
                .where("warehouseShareLink.id", "in", targetMappings.map(m => m.shareLinkId))
                .distinct()
                .execute();

              const sourceWarehouseIds = sourceWarehouses.map(w => w.warehouseId);

              if (sourceWarehouseIds.length === 0) {
                console.log(`[DEBUG_STOCK_UPDATE] No source warehouses found for targetProductId: ${targetProductId}`);
                continue;
              }

              console.log(`[DEBUG_STOCK_UPDATE] Found source warehouses for targetProductId: ${targetProductId}`, sourceWarehouseIds);

              // Step 5: Fetch all stock entries for the source product across all shared source warehouses
              const sourceStocks = await db
                .selectFrom("warehouseStock")
                .select(["variationId", "country", "quantity"])
                .where("productId", "=", id)
                .where("warehouseId", "in", sourceWarehouseIds)
                .execute();

              console.log(`[DEBUG_STOCK_UPDATE] Source stock entries for productId: ${id} across source warehouses:`, sourceStocks);

              // Step 6: Aggregate stock by variationId and country
              const stockByKey: Record<
                string,
                { quantity: number; variationId: string | null; country: string }
              > = {};

              for (const stock of sourceStocks) {
                const key = `${stock.variationId || "no-variation"}:${stock.country}`;
                if (!stockByKey[key]) {
                  stockByKey[key] = {
                    quantity: 0,
                    variationId: stock.variationId,
                    country: stock.country,
                  };
                }
                stockByKey[key].quantity = stock.quantity;
              }

              console.log(`[DEBUG_STOCK_UPDATE] Aggregated stock for productId: ${id} by variationId and country:`, stockByKey);

              // Step 7: Update stock for each target warehouse
              for (const targetWarehouse of targetWarehouses) {
                // Fetch User B's organizationId using recipientUserId
                const recipientMembership = await db
                  .selectFrom("member")
                  .select("organizationId")
                  .where("userId", "=", recipientUserId)
                  .executeTakeFirst();

                if (!recipientMembership) {
                  console.log(`[DEBUG_STOCK_UPDATE] No membership found for recipientUserId: ${recipientUserId}, skipping`);
                  continue;
                }

                const recipientOrganizationId = recipientMembership.organizationId;

                console.log(`[DEBUG_STOCK_UPDATE] Target warehouse - warehouseId: ${targetWarehouse.id}, tenantId: ${targetWarehouse.tenantId}, recipientOrganizationId: ${recipientOrganizationId}`);

                // Process each aggregated stock entry
                for (const [key, { variationId, country, quantity }] of Object.entries(stockByKey)) {
                  const actualVariationId = variationId === "no-variation" ? null : variationId;

                  console.log(
                    `[DEBUG_STOCK_UPDATE] Processing stock update for targetProductId: ${targetProductId}, variationId: ${actualVariationId || "null"}, country: ${country}, aggregated quantity: ${quantity}`
                  );

                  // Step 8: Map the source variationId to the target variationId (if applicable)
                  let targetVariationId: string | null = null;
                  if (actualVariationId) {
                    const variationMapping = await db
                      .selectFrom("sharedVariationMapping")
                      .select("targetVariationId")
                      .where("shareLinkId", "in", targetMappings.map(m => m.shareLinkId))
                      .where("sourceProductId", "=", id)
                      .where("targetProductId", "=", targetProductId)
                      .where("sourceVariationId", "=", actualVariationId)
                      .executeTakeFirst();

                    if (!variationMapping) {
                      console.log(`[DEBUG_STOCK_UPDATE] No variation mapping found for sourceVariationId: ${actualVariationId}, skipping`);
                      continue;
                    }
                    targetVariationId = variationMapping.targetVariationId;
                    console.log(`[DEBUG_STOCK_UPDATE] Mapped sourceVariationId: ${actualVariationId} to targetVariationId: ${targetVariationId}`);
                  }

                  // Step 9: Update or insert the aggregated stock in User B's warehouse
                  let targetStockQuery = db
                    .selectFrom("warehouseStock")
                    .select(["id"])
                    .where("productId", "=", targetProductId)
                    .where("warehouseId", "=", targetWarehouse.id)
                    .where("country", "=", country);

                  if (targetVariationId) {
                    targetStockQuery = targetStockQuery.where("variationId", "=", targetVariationId);
                  } else {
                    targetStockQuery = targetStockQuery.where("variationId", "is", null);
                  }

                  const targetStock = await targetStockQuery.executeTakeFirst();

                  if (targetStock) {
                    console.log(
                      `[DEBUG_STOCK_UPDATE] Updating existing stock entry for targetProductId: ${targetProductId}, warehouseId: ${targetWarehouse.id}, country: ${country}, quantity: ${quantity}`
                    );
                    await db
                      .updateTable("warehouseStock")
                      .set({
                        quantity: quantity,
                        updatedAt: new Date(),
                      })
                      .where("id", "=", targetStock.id)
                      .execute();
                  } else {
                    console.log(
                      `[DEBUG_STOCK_UPDATE] Inserting new stock entry for targetProductId: ${targetProductId}, warehouseId: ${targetWarehouse.id}, country: ${country}, quantity: ${quantity}`
                    );
                    await db
                      .insertInto("warehouseStock")
                      .values({
                        id: generateId("WS"),
                        warehouseId: targetWarehouse.id,
                        productId: targetProductId,
                        variationId: targetVariationId,
                        country,
                        quantity: quantity,
                        organizationId: recipientOrganizationId,
                        tenantId: targetWarehouse.tenantId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                      })
                      .execute();
                  }

                  console.log(`[DEBUG_STOCK_UPDATE] Successfully updated stock for targetProductId: ${targetProductId} in warehouseId: ${targetWarehouse.id}`);
                }
              }
            }
          }
        }
      }

       /* -------------------------------------------------------------- */
    /* **NEW** product-change propagation to shared copies           */
    /* -------------------------------------------------------------- */
    // Only propagate if this is a source product (User A)
    const sharedEntries = await db
      .selectFrom("sharedProduct")
      .select("shareLinkId")
      .where("productId", "=", id)
      .execute();
    if (sharedEntries.length) {
      const mappings = await db
        .selectFrom("sharedProductMapping")
        .select(["sourceProductId", "targetProductId", "shareLinkId"])
        .where("sourceProductId", "=", id)
        .where("shareLinkId", "in", sharedEntries.map(s => s.shareLinkId))
        .execute();
      for (const map of mappings) {
        // 1) propagate status
        if (parsedUpdate.status) {
          await db
            .updateTable("products")
            .set({ status: parsedUpdate.status, updatedAt: new Date() })
            .where("id", "=", map.targetProductId)
            .execute();
        }
      }
    }

      return NextResponse.json({
        product: { id, ...parsedUpdate, updatedAt: new Date().toISOString() },
      });
    } catch (error) {
      const { id } = await params;
      console.error(`[PRODUCT_PATCH_${id}]`, error);
      if (error instanceof z.ZodError)
        return NextResponse.json({ error: error.errors }, { status: 400 });
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }

  /* ================================================================== */
  /* DELETE                                                            */
  /* ================================================================== */
  export async function DELETE(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) {
    try {
      const session = await auth.api.getSession({ headers: req.headers });
      if (!session) {
        return NextResponse.json({ error: "Unauthorized: No session found" }, { status: 401 });
      }
      const organizationId = session.session.activeOrganizationId;
      if (!organizationId) {
        return NextResponse.json({ error: "No active organization" }, { status: 400 });
      }
      const { id } = await params;
      const existingProduct = await db
        .selectFrom("products")
        .select("id")
        .where("id", "=", id)
        .where("organizationId", "=", organizationId)
        .executeTakeFirst();
      if (!existingProduct) {
        return NextResponse.json({ error: "Product not found" }, { status: 404 });
      }
       await db.deleteFrom("productCategory").where("productId", "=", id).execute();
       await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
       await db.deleteFrom("productVariations").where("productId", "=", id).execute();
      // 1) clean up all the “shared” records that reference this as the source
      const sharedLinks = await db
        .selectFrom("sharedProduct")
        .select("shareLinkId")
        .where("productId", "=", id)
        .execute();
      if (sharedLinks.length) {
        const linkIds = sharedLinks.map((r) => r.shareLinkId);
      
        // a) delete any sharedProductMapping / sharedVariationMapping rows
          // 1) grab all B-side copies BEFORE we nuke the mappings:
          const mappings = await db
            .selectFrom("sharedProductMapping")
            .select("targetProductId")
            .where("sourceProductId", "=", id)
            .execute();
          const targetIds = mappings.map((r) => r.targetProductId);
      
        // b) delete the sharedProduct entries themselves
        await db
          .deleteFrom("sharedProduct")
          .where("productId", "=", id)
          .execute();
      
        
          // now delete each copy in B’s tenants (using the list we fetched above):
          for (const targetProductId of targetIds) {
          await db.deleteFrom("warehouseStock").where("productId", "=", targetProductId).execute();
          await db.deleteFrom("productVariations").where("productId", "=", targetProductId).execute();
          await db.deleteFrom("productCategory").where("productId", "=", targetProductId).execute();
          await db.deleteFrom("productAttributeValues").where("productId", "=", targetProductId).execute();
          await db.deleteFrom("products").where("id", "=", targetProductId).execute();
        }
      }
      
      // … now delete your own product’s rows …
      await db.deleteFrom("productCategory").where("productId", "=", id).execute();
      await db.deleteFrom("productAttributeValues").where("productId", "=", id).execute();
      await db.deleteFrom("productVariations").where("productId", "=", id).execute();
      await db.deleteFrom("products").where("id", "=", id).execute();
      return NextResponse.json({ message: "Product deleted successfully" });
    } catch (error) {
      const { id } = await params;
      console.error(`[PRODUCT_DELETE_${id}]`, error);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
  }