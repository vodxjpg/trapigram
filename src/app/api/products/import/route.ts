// app/api/product/import/route.ts
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { NextResponse } from "next/server";
import { pgPool } from "@/lib/db";
import sanitizeHtml from "sanitize-html";
import { v4 as uuidv4 } from "uuid";

// Run this route in Node.js so that Buffer, FormData.arrayBuffer(), etc. work
// app/api/product/import/route.ts
export const runtime = "nodejs";        // you already have this
export const dynamic = "force-dynamic"; // ensure it never gets statically optimized/cached
export const maxDuration = 300;         // ask the platform for up to 300s for this route

function safeTrim(value: any): string {
    return typeof value === "string" ? value.trim() : "";
}

function cleanDescription(dirty: string) {
    return sanitizeHtml(dirty, {
        // whitelist only the tags you actually want (you can also leave this out
        // and use the defaultAllowedTags minus script/img)
        allowedTags: [
            "p", "br", "b", "i", "em", "strong",
            "ul", "ol", "li", "a", "span", "div",
            /* …any others you need… */
        ],
        // and only allow safe attributes
        allowedAttributes: {
            a: ["href", "target"],
            // no img, so no img attributes
        },
        // strip out any disallowed tags entirely
        nonTextTags: ["script", "style", "img"],
    });
}

function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const arrayToJson = (arr) =>
    arr.reduce((acc, pair) => {
        const [key, value] = pair.split(":").map((s) => safeTrim(s));
        acc[key] = Number(value);
        return acc;
    }, {});

type CategoryEntry = {
    id: string
}

type AttributeEntry = {
    attId: string,
    termId: string,
}

export async function POST(req: Request) {
    const ctx = await getContext(req);
    if (ctx instanceof NextResponse) return ctx;
    const { organizationId, userId } = ctx;

    // collect per-row errors
    const rowErrors: Array<{ row: number; error: string }> = [];
    let successCount = 0;
    let editCount = 0
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
        return NextResponse.json({ error: "No file provided under key 'file'" }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: "buffer" });

    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // 1) Grab everything as an array of arrays (header:1)
    const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, {
        header: 1,
        defval: "",       // empty cells as ""
        blankrows: false, // skip blank lines
    });

    // 2) Pull off the header row, skip the second row, collect the rest
    const [headerRow, ...dataRows] = rows;

    // 3) Rebuild an array of objects, mapping each dataRow back to headerRow
    const data = dataRows.map((row) => {
        const obj: Record<string, any> = {};
        headerRow.forEach((colName: string, idx: number) => {
            let cell = row[idx];
            if (colName === "id" && (!cell || cell === "")) {
                cell = "no-id";
            }
            obj[colName] = cell;
        });
        return obj;
    });

    if (!data) {
        return NextResponse.json({ error: "File is empty" }, { status: 400 });
    }

    const tenant = await db.selectFrom("tenant").select("id").where("ownerUserId", "=", userId).executeTakeFirst()
    if (!tenant) return NextResponse.json({ error: "No tenant found for user" }, { status: 404 })
    const tenantId = tenant.id

    try {

        // process each product row separately
        for (let i = 0; i < data.length; i++) {

            const product = data[i];
            const rowNumber = i + 3;
            const hasId = product.id && product.id !== "no-id";
            const lookUpValue = hasId ? product.id : product.sku;

            // 1) find existing by id or sku
            let res = ""
            if (safeTrim(product.productType) === "variation") {
                const productIdQuery = `SELECT id FROM products WHERE sku = '${product.parent}'`
                const productIdResult = await pgPool.query(productIdQuery)
                const productId = productIdResult.rows[0].id

                const findQuery = `SELECT * FROM "productVariations" WHERE "productId" = '${productId}' AND sku='${product.sku}'`
                const result = await pgPool.query(findQuery);
                res = result
            } else {
                const findQuery = hasId
                    ? `SELECT * FROM products WHERE id = $1`
                    : `SELECT * FROM products WHERE sku = $1`;
                const result = await pgPool.query(findQuery, [lookUpValue]);
                res = result
            }

            if (res.rows.length === 0) {
                console.log("CREATING")

                if (product.productType === "simple") {
                    /* SKU handling */
                    let finalSku = product.sku
                    if (!finalSku) {
                        do {
                            finalSku = `SKU-${uuidv4().slice(0, 8)}`
                        } while (await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst())
                    } else {
                        const exists = await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst()
                        if (exists) throw new Error("SKU already exists")
                    }

                    const slugs = product.categories
                    const catArray = slugs
                        .split(",")
                        .map(s => safeTrim(s));

                    const categories: CategoryEntry[] = [];

                    for (const cat of catArray) {
                        const catQuery = `SELECT id FROM "productCategories" WHERE slug = '${cat}' AND "organizationId" = '${organizationId}'`
                        const catResult = await pgPool.query(catQuery)

                        if (catResult.rows.length > 0) {
                            categories.push(catResult.rows[0].id)
                        }

                        if (catResult.rows.length === 0) {
                            const name = capitalizeFirstLetter(cat)
                            const categoryId = uuidv4()
                            const newCategoryQuery = `INSERT INTO "productCategories"(id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
                            VALUES ('${categoryId}', '${name}', '${cat}', ${null}, 0, ${null}, '${organizationId}', NOW(), NOW())
                            RETURNING *`

                            await pgPool.query(newCategoryQuery)

                            categories.push(categoryId)
                        }

                        /* category validation */
                        if (categories?.length) {
                            const validIds = (await db.selectFrom("productCategories")
                                .select("id")
                                .where("organizationId", "=", organizationId)
                                .execute()).map(c => c.id)
                            const bad = categories.filter(id => !validIds.includes(id))
                            if (bad.length) throw new Error(`Invalid category IDs: ${bad.join(", ")}`)
                        }
                    }

                    const productId = uuidv4()

                    const rp = product.regularPrice ?? "";
                    const rawRegularPrice = typeof rp === "string"
                        ? rp.split(",").map(s => safeTrim(s))
                        : [];
                    const regularPrice = arrayToJson(rawRegularPrice);

                    const sp = product.salePrice ?? "";
                    const rawSalePrice = typeof sp === "string"
                        ? sp.split(",").map(s => safeTrim(s))
                        : [];
                    const salePrice = arrayToJson(rawSalePrice);

                    const ct = product.cost ?? "";
                    const rawCost = typeof ct === "string"
                        ? ct.split(",").map(s => safeTrim(s))
                        : [];
                    const cost = arrayToJson(rawCost);

                    const safeDescription = cleanDescription(product.description);

                    await db.insertInto("products").values({
                        id: productId,
                        organizationId,
                        tenantId,
                        title: product.title,
                        description: safeDescription,
                        image: null,
                        sku: finalSku,
                        status: product.published === 1 ? "published" : "draft",
                        productType: product.productType,
                        regularPrice: regularPrice,
                        salePrice: salePrice,
                        cost: cost ?? {},
                        allowBackorders: product.allowBackorders === 1 ? true : false,
                        manageStock: product.manageStock === 1 ? true : false,
                        stockStatus: "managed",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }).execute()

                    if (categories?.length) {
                        for (const cid of categories) {
                            await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                        }
                    }

                    const attributes: AttributeEntry[] = [];
                    const obj = {}

                    for (let i = 1; i <= 5; i++) {
                        if (product[`attributeSlug${i}`] !== "") {
                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => safeTrim(s));

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}' AND "organizationId" = '${organizationId}'`
                            const nameResult = await pgPool.query(nameQuery)

                            let nameId = ""

                            if (nameResult.rows.length > 0) {
                                nameId = nameResult.rows[0].id
                            }

                            if (nameResult.rows.length === 0) {
                                const attName = capitalizeFirstLetter(name)
                                const attId = uuidv4()
                                const newAttQuery = `INSERT INTO "productAttributes"(id, name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${attId}', '${attName}', '${name}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                await pgPool.query(newAttQuery)

                                nameId = attId
                            }

                            for (const t of termsArray) {
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}' AND "organizationId" = '${organizationId}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id

                                    attributes.push({
                                        attId: nameId,
                                        termId: termId,
                                    })
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId

                                    attributes.push({
                                        attId: nameId,
                                        termId: termId,
                                    })
                                }
                            }
                        }
                    }

                    const countries = product.countries.toString()
                    const countryArray = countries
                        .split(",")
                        .map(s => safeTrim(s));

                    const stocks = product.stock.toString()
                    const stockArray = stocks
                        .split(",")
                        .map(s => safeTrim(s));

                    for (let i = 0; i < countryArray.length; i++) {
                        await db.insertInto("warehouseStock").values({
                            id: uuidv4(),
                            warehouseId: product.warehouseId,
                            productId,                        // ← use the local const `productId`
                            variationId: null,
                            country: countryArray[i],
                            quantity: stockArray[i],
                            organizationId,
                            tenantId,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }).execute()
                    }

                    for (const att of attributes) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: att.attId, termId: att.termId })
                            .execute()
                    }
                    successCount++
                }

                if (product.productType === "variable") {

                    let finalSku = product.sku
                    if (!finalSku) {
                        do {
                            finalSku = `SKU-${uuidv4().slice(0, 8)}`
                        } while (await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst())
                    } else {
                        const exists = await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst()
                        if (exists) throw new Error("SKU already exists")
                    }

                    const slugs = product.categories
                    const catArray = slugs
                        .split(",")
                        .map(s => safeTrim(s));

                    const categories: CategoryEntry[] = [];

                    for (const cat of catArray) {
                        const catQuery = `SELECT id FROM "productCategories" WHERE slug = '${cat}' AND "organizationId" = '${organizationId}'`
                        const catResult = await pgPool.query(catQuery)

                        if (catResult.rows.length > 0) {
                            categories.push(catResult.rows[0].id)
                        }

                        if (catResult.rows.length === 0) {
                            const name = capitalizeFirstLetter(cat)
                            const categoryId = uuidv4()
                            const newCategoryQuery = `INSERT INTO "productCategories"(id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
                            VALUES ('${categoryId}', '${name}', '${cat}', ${null}, 0, ${null}, '${organizationId}', NOW(), NOW())
                            RETURNING *`

                            await pgPool.query(newCategoryQuery)

                            categories.push(categoryId)
                        }

                        /* category validation */
                        if (categories?.length) {
                            const validIds = (await db.selectFrom("productCategories")
                                .select("id")
                                .where("organizationId", "=", organizationId)
                                .execute()).map(c => c.id)
                            const bad = categories.filter(id => !validIds.includes(id))
                            if (bad.length) throw new Error(`Invalid category IDs: ${bad.join(", ")}`)
                        }
                    }

                    const productId = uuidv4()

                    const safeDescription = cleanDescription(product.description);

                    await db.insertInto("products").values({
                        id: productId,
                        organizationId,
                        tenantId,
                        title: product.title,
                        description: safeDescription,
                        image: null,
                        sku: finalSku,
                        status: product.published === 1 ? "published" : "draft",
                        productType: product.productType,
                        regularPrice: {},
                        salePrice: {},
                        cost: {},
                        allowBackorders: product.allowBackorders === 1 ? true : false,
                        manageStock: product.manageStock === 1 ? true : false,
                        stockStatus: "managed",
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }).execute()

                    if (categories?.length) {
                        for (const cid of categories) {
                            await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                        }
                    }

                    const attributes: AttributeEntry[] = [];
                    const obj = {}

                    for (let i = 1; i <= 5; i++) {
                        if (product[`attributeSlug${i}`] !== "") {
                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => safeTrim(s));

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}' AND "organizationId" = '${organizationId}'`
                            const nameResult = await pgPool.query(nameQuery)

                            let nameId = ""

                            if (nameResult.rows.length > 0) {
                                nameId = nameResult.rows[0].id
                            }

                            if (nameResult.rows.length === 0) {
                                const attName = capitalizeFirstLetter(name)
                                const attId = uuidv4()
                                const newAttQuery = `INSERT INTO "productAttributes"(id, name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${attId}', '${attName}', '${name}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                await pgPool.query(newAttQuery)

                                nameId = attId
                            }

                            for (const t of termsArray) {
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}' AND "organizationId" = '${organizationId}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id

                                    attributes.push({
                                        attId: nameId,
                                        termId: termId,
                                    })
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId

                                    attributes.push({
                                        attId: nameId,
                                        termId: termId,
                                    })
                                }
                            }
                        }
                    }

                    for (const att of attributes) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: att.attId, termId: att.termId })
                            .execute()
                    }
                    successCount++
                }

                if (product.productType === "variation") {
                    const parentSku = product.parent

                    /* SKU handling */
                    let finalSku = product.sku
                    if (!finalSku) {
                        do {
                            finalSku = `SKU-${uuidv4().slice(0, 8)}`
                        } while (await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst())
                    } else {
                        const exists = await db.selectFrom("products").select("id")
                            .where("sku", "=", finalSku)
                            .where("organizationId", "=", organizationId)
                            .executeTakeFirst()
                        if (exists) throw new Error("SKU already exists")
                    }

                    const productIdQuery = `SELECT id FROM products WHERE sku = '${parentSku}'`
                    const productIdResult = await pgPool.query(productIdQuery)
                    const productId = productIdResult.rows[0].id

                    const variationId = uuidv4()

                    const rp = product.regularPrice ?? "";
                    const rawRegularPrice = typeof rp === "string"
                        ? rp.split(",").map(s => safeTrim(s))
                        : [];
                    const regularPrice = arrayToJson(rawRegularPrice);

                    const sp = product.salePrice ?? "";
                    const rawSalePrice = typeof sp === "string"
                        ? sp.split(",").map(s => safeTrim(s))
                        : [];
                    const salePrice = arrayToJson(rawSalePrice);

                    const ct = product.cost ?? "";
                    const rawCost = typeof ct === "string"
                        ? ct.split(",").map(s => safeTrim(s))
                        : [];
                    const cost = arrayToJson(rawCost);

                    const obj = {}

                    if (product.attributeSlug1 !== "") {
                        const termSlug = product.attributeValues1

                        const name = product.attributeSlug1
                        const nameAttQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}' AND "organizationId" = '${organizationId}'`
                        const nameAttResult = await pgPool.query(nameAttQuery)

                        let attId = ""

                        if (nameAttResult.rows.length > 0) {
                            attId = nameAttResult.rows[0].id
                        }

                        if (nameAttResult.rows.length === 0) {
                            const attName = capitalizeFirstLetter(name)
                            attId = uuidv4()
                            const newAttQuery = `INSERT INTO "productAttributes"(id, name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${attId}', '${attName}', '${name}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                            await pgPool.query(newAttQuery)
                        }

                        const nameTermQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${termSlug}' AND "organizationId" = '${organizationId}'`
                        const nameTermResult = await pgPool.query(nameTermQuery)

                        let termId = ""

                        if (nameTermResult.rows.length > 0) {
                            termId = nameTermResult.rows[0].id
                        }

                        if (nameTermResult.rows.length === 0) {
                            const attTerm = capitalizeFirstLetter(termSlug)
                            termId = uuidv4()
                            const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${attId}', '${attTerm}', '${termSlug}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                            await pgPool.query(newAttQuery)
                        }
                        obj[attId] = termId
                    }

                    await db.insertInto("productVariations").values({
                        id: variationId,
                        productId,
                        image: null,
                        sku: finalSku,
                        regularPrice: regularPrice,
                        salePrice: salePrice,
                        cost: cost ?? {},
                        attributes: obj,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }).execute()

                    const countries = product.countries.toString()
                    const countryArray = countries
                        .split(",")
                        .map(s => safeTrim(s));

                    const stocks = product.stock.toString()
                    const stockArray = stocks
                        .split(",")
                        .map(s => safeTrim(s));

                    for (let i = 0; i < countryArray.length; i++) {
                        await db.insertInto("warehouseStock").values({
                            id: uuidv4(),
                            warehouseId: product.warehouseId,
                            productId,                        // ← use the local const `productId`
                            variationId,
                            country: countryArray[i],
                            quantity: stockArray[i],
                            organizationId,
                            tenantId,
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }).execute()
                    }

                    successCount++
                }
            }

            if (res.rows.length > 0) {
                console.log("UPDATING")

                if (product.productType === "simple") {
                    const productId = res.rows[0].id
                    const existing = res.rows[0];
                    const safeDescription = cleanDescription(product.description);
                    console.log(safeDescription)

                    const rp = product.regularPrice ?? "";
                    const rawRegularPrice = typeof rp === "string"
                        ? rp.split(",").map(s => safeTrim(s))
                        : [];
                    const regularPrice = arrayToJson(rawRegularPrice);

                    const sp = product.salePrice ?? "";
                    const rawSalePrice = typeof sp === "string"
                        ? sp.split(",").map(s => safeTrim(s))
                        : [];
                    const salePrice = arrayToJson(rawSalePrice);

                    const ct = product.cost ?? "";
                    const rawCost = typeof ct === "string"
                        ? ct.split(",").map(s => safeTrim(s))
                        : [];
                    const cost = arrayToJson(rawCost);

                    // start with the timestamp
                    const updatePayload: Record<string, any> = {
                        updatedAt: new Date(),
                    };
                    const columnExists = (col: string) => headerRow.includes(col);

                    // only include each field if the incoming cell wasn’t empty
                    if (columnExists("title") && product.title && safeTrim(product.title) !== "") {
                        updatePayload.title = product.title;
                    }

                    if (columnExists("description") && product.description && safeTrim(product.description) !== "") {
                        updatePayload.description = safeDescription;
                    }

                    if (columnExists("sku") && hasId && product.sku && safeTrim(product.sku) !== "") {
                        updatePayload.sku = product.sku;
                    }

                    if (columnExists("status") && product.published !== "" && (product.published === 1 || product.published === 0)) {
                        updatePayload.status = product.published === 1 ? "published" : "draft";
                    }

                    if (columnExists("manageStock") && product.manageStock !== "" && (product.manageStock === 1 || product.manageStock === 0)) {
                        updatePayload.manageStock = product.manageStock === 1 ? true : false;
                    }

                    if (columnExists("backorder") && product.backorder !== "" && (product.backorder === 1 || product.backorder === 0)) {
                        updatePayload.allowBackorders = product.backorder === 1 ? true : false;
                    }

                    if (columnExists("productType") && product.productType && safeTrim(product.productType) !== "" && safeTrim(product.productType) !== "variation") {
                        updatePayload.productType = product.productType;
                    }

                    if (columnExists("regularPrice") && product.regularPrice && safeTrim(product.regularPrice) !== "") {
                        updatePayload.regularPrice = regularPrice;
                    }

                    if (columnExists("salePrice") && product.salePrice && safeTrim(product.salePrice) !== "") {
                        updatePayload.salePrice = salePrice;
                    }

                    if (columnExists("cost") && product.cost && safeTrim(product.cost) !== "") {
                        updatePayload.cost = cost;
                    }

                    // now run the update
                    try {
                        await db
                            .updateTable("products")
                            .set(updatePayload)
                            .where("id", "=", existing.id)
                            .execute();
                    } catch (opErr: any) {
                        rowErrors.push({
                            row: rowNumber,
                            error: `Failed to update product ${lookUpValue}: ${opErr.message}`,
                        });
                        // skip further operations on this row
                        throw opErr;
                    }

                    let newCategories = false
                    const checkCategories = (product.categories && safeTrim(product.categories) !== "")

                    if (checkCategories) {
                        await db.deleteFrom("productCategory").where("productId", "=", existing.id).execute();
                        newCategories = true
                    }

                    let newWarehouse = false
                    const checkWarehouse = (product.warehouseId && product.warehouseId !== "")
                    const checkCountries = (product.countries && product.countries !== "")
                    const checkStock = (product.stock && product.stock !== "")
                    if (checkWarehouse && checkCountries && checkStock) {
                        newWarehouse = true
                    }

                    let newAttributes = false
                    const checkAttributes: [] = []
                    for (let i = 1; i <= 5; i++) {
                        if (product[`attributeSlug${i}`] !== "") {
                            checkAttributes.push(true)
                        }
                    }

                    if (checkAttributes.length > 0) {
                        newAttributes = true
                    }

                    const categories: CategoryEntry[] = [];

                    if (newCategories) {
                        const slugs = product.categories
                        const catArray = slugs
                            .split(",")
                            .map(s => safeTrim(s));

                        for (const cat of catArray) {
                            const catQuery = `SELECT id FROM "productCategories" WHERE slug = '${cat}' AND "organizationId" = '${organizationId}'`
                            const catResult = await pgPool.query(catQuery)

                            if (catResult.rows.length > 0) {
                                categories.push(catResult.rows[0].id)
                            }

                            if (catResult.rows.length === 0) {
                                const name = capitalizeFirstLetter(cat)
                                const categoryId = uuidv4()
                                const newCategoryQuery = `INSERT INTO "productCategories"(id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
                            VALUES ('${categoryId}', '${name}', '${cat}', ${null}, 0, ${null}, '${organizationId}', NOW(), NOW())
                            RETURNING *`

                                try {
                                    await pgPool.query(newCategoryQuery)
                                } catch (opErr: any) {
                                    rowErrors.push({
                                        row: rowNumber,
                                        error: `Failed to update categories ${lookUpValue}: ${opErr.message}`,
                                    });
                                }

                                categories.push(categoryId)
                            }

                            /* category validation */
                            if (categories?.length) {
                                const validIds = (await db.selectFrom("productCategories")
                                    .select("id")
                                    .where("organizationId", "=", organizationId)
                                    .execute()).map(c => c.id)
                                const bad = categories.filter(id => !validIds.includes(id))
                                if (bad.length) throw new Error(`Invalid category IDs: ${bad.join(", ")}`)
                            }
                        }

                        if (categories?.length) {
                            for (const cid of categories) {
                                await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                            }
                        }
                    }

                    if (newAttributes) {
                        const attributes: AttributeEntry[] = [];

                        for (let i = 1; i <= 2; i++) {

                            if (product[`attributeSlug${i}`] !== "") {
                                const terms = product[`attributeValues${i}`]
                                const termsArray = terms
                                    .split(",")
                                    .map(s => safeTrim(s));

                                const name = product[`attributeSlug${i}`]
                                const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}' AND "organizationId" = '${organizationId}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let nameId = ""

                                if (nameResult.rows.length > 0) {
                                    nameId = nameResult.rows[0].id
                                    await db.deleteFrom("productAttributeValues")
                                        .where("productId", "=", productId)
                                        .where("attributeId", "=", nameId)
                                        .execute();
                                }

                                if (nameResult.rows.length === 0) {
                                    const attName = capitalizeFirstLetter(name)
                                    const attId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributes"(id, name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${attId}', '${attName}', '${name}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)

                                    nameId = attId
                                }

                                for (const t of termsArray) {
                                    const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}' AND "organizationId" = '${organizationId}'`
                                    const nameResult = await pgPool.query(nameQuery)

                                    let termId = ""
                                    const obj = {}

                                    if (nameResult.rows.length > 0) {
                                        termId = nameResult.rows[0].id

                                        attributes.push({
                                            attId: nameId,
                                            termId: termId,
                                        })
                                    }

                                    if (nameResult.rows.length === 0) {
                                        const attTerm = capitalizeFirstLetter(t)
                                        termId = uuidv4()
                                        const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                        await pgPool.query(newAttQuery)

                                        attributes.push({
                                            attId: nameId,
                                            termId: termId,
                                        })
                                    }
                                }
                            }
                        }

                        for (const att of attributes) {
                            await db.insertInto("productAttributeValues")
                                .values({ productId, attributeId: att.attId, termId: att.termId })
                                .execute()
                        }
                    }

                    if (newWarehouse) {
                        const countries = product.countries
                        const countryArray = countries
                            .split(",")
                            .map(s => safeTrim(s));
                        if (countryArray.length === 0) countryArray.push(countries)
                        const warehouseId = product.warehouseId

                        const stocks = (product.stock).toString()
                        const stockArray = stocks
                            .split(",")
                            .map(s => safeTrim(s));
                        if (stockArray.length === 0) stockArray.push(stocks)

                        for (let i = 0; i < countryArray.length; i++) {
                            await db.updateTable("warehouseStock")
                                .set({ quantity: stockArray[i] })
                                .where("country", "=", countryArray[i])
                                .where("productId", "=", productId)
                                .where("warehouseId", "=", warehouseId)
                                .execute()
                        }
                    }
                    editCount++
                    console.log("simple", editCount)
                }

                if (product.productType === "variable") {
                    const productId = res.rows[0].id
                    const existing = res.rows[0];
                    const safeDescription = cleanDescription(product.description);

                    // start with the timestamp
                    const updatePayload: Record<string, any> = {
                        updatedAt: new Date(),
                    };
                    const columnExists = (col: string) => headerRow.includes(col);

                    // only include each field if the incoming cell wasn’t empty
                    if (columnExists("title") && product.title && safeTrim(product.title) !== "") {
                        updatePayload.title = product.title;
                    }

                    if (columnExists("description") && product.description && safeTrim(product.description) !== "") {
                        updatePayload.description = safeDescription;
                    }

                    if (columnExists("sku") && hasId && product.sku && safeTrim(product.sku) !== "") {
                        updatePayload.sku = product.sku;
                    }

                    if (columnExists("status") && product.published !== "" && (product.published === 1 || product.published === 0)) {
                        updatePayload.status = product.published === 1 ? "published" : "draft";
                    }

                    if (columnExists("manageStock") && product.manageStock !== "" && (product.manageStock === 1 || product.manageStock === 0)) {
                        updatePayload.manageStock = product.manageStock === 1 ? true : false;
                    }

                    if (columnExists("backorder") && product.backorder !== "" && (product.backorder === 1 || product.backorder === 0)) {
                        updatePayload.allowBackorders = product.backorder === 1 ? true : false;
                    }

                    if (columnExists("productType") && product.productType && safeTrim(product.productType) !== "") {
                        updatePayload.productType = product.productType;
                    }

                    // now run the update
                    try {
                        await db
                            .updateTable("products")
                            .set(updatePayload)
                            .where("id", "=", existing.id)
                            .execute();
                    } catch (opErr: any) {
                        rowErrors.push({
                            row: rowNumber,
                            error: `Failed to update product ${lookUpValue}: ${opErr.message}`,
                        });
                        // skip further operations on this row
                        throw opErr;
                    }

                    let newCategories = false
                    const checkCategories = (product.categories && safeTrim(product.categories) !== "")

                    if (checkCategories) {
                        await db.deleteFrom("productCategory").where("productId", "=", existing.id).execute();
                        newCategories = true
                    }

                    let newAttributes = false
                    const checkAttributes: [] = []
                    for (let i = 1; i <= 5; i++) {
                        if (product[`attributeSlug${i}`] !== "") {
                            checkAttributes.push(true)
                        }
                    }

                    if (checkAttributes.length > 0) {
                        newAttributes = true
                    }

                    const categories: CategoryEntry[] = [];

                    if (newCategories) {
                        const slugs = product.categories
                        const catArray = slugs
                            .split(",")
                            .map(s => safeTrim(s));

                        for (const cat of catArray) {
                            const catQuery = `SELECT id FROM "productCategories" WHERE slug = '${cat}' AND "organizationId" = '${organizationId}'`
                            const catResult = await pgPool.query(catQuery)

                            if (catResult.rows.length > 0) {
                                categories.push(catResult.rows[0].id)
                            }

                            if (catResult.rows.length === 0) {
                                const name = capitalizeFirstLetter(cat)
                                const categoryId = uuidv4()
                                const newCategoryQuery = `INSERT INTO "productCategories"(id, name, slug, image, "order", "parentId", "organizationId", "createdAt", "updatedAt")
                            VALUES ('${categoryId}', '${name}', '${cat}', ${null}, 0, ${null}, '${organizationId}', NOW(), NOW())
                            RETURNING *`

                                try {
                                    await pgPool.query(newCategoryQuery)
                                } catch (opErr: any) {
                                    rowErrors.push({
                                        row: rowNumber,
                                        error: `Failed to update categories ${lookUpValue}: ${opErr.message}`,
                                    });
                                }

                                categories.push(categoryId)
                            }

                            /* category validation */
                            if (categories?.length) {
                                const validIds = (await db.selectFrom("productCategories")
                                    .select("id")
                                    .where("organizationId", "=", organizationId)
                                    .execute()).map(c => c.id)
                                const bad = categories.filter(id => !validIds.includes(id))
                                if (bad.length) throw new Error(`Invalid category IDs: ${bad.join(", ")}`)
                            }
                        }

                        if (categories?.length) {
                            for (const cid of categories) {
                                await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                            }
                        }
                    }

                    if (newAttributes) {
                        const attributes: AttributeEntry[] = [];

                        for (let i = 1; i <= 2; i++) {

                            if (product[`attributeSlug${i}`] !== "") {
                                const terms = product[`attributeValues${i}`]
                                const termsArray = terms
                                    .split(",")
                                    .map(s => safeTrim(s));

                                const name = product[`attributeSlug${i}`]
                                const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}' AND "organizationId" = '${organizationId}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let nameId = ""

                                if (nameResult.rows.length > 0) {
                                    nameId = nameResult.rows[0].id
                                    await db.deleteFrom("productAttributeValues")
                                        .where("productId", "=", productId)
                                        .where("attributeId", "=", nameId)
                                        .execute();
                                }

                                if (nameResult.rows.length === 0) {
                                    const attName = capitalizeFirstLetter(name)
                                    const attId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributes"(id, name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${attId}', '${attName}', '${name}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)

                                    nameId = attId
                                }

                                for (const t of termsArray) {
                                    const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}' AND "organizationId" = '${organizationId}'`
                                    const nameResult = await pgPool.query(nameQuery)

                                    let termId = ""
                                    const obj = {}

                                    if (nameResult.rows.length > 0) {
                                        termId = nameResult.rows[0].id

                                        attributes.push({
                                            attId: nameId,
                                            termId: termId,
                                        })
                                    }

                                    if (nameResult.rows.length === 0) {
                                        const attTerm = capitalizeFirstLetter(t)
                                        termId = uuidv4()
                                        const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                        await pgPool.query(newAttQuery)

                                        attributes.push({
                                            attId: nameId,
                                            termId: termId,
                                        })
                                    }
                                }
                            }
                        }

                        for (const att of attributes) {
                            await db.insertInto("productAttributeValues")
                                .values({ productId, attributeId: att.attId, termId: att.termId })
                                .execute()
                        }
                    }
                    editCount++
                    console.log("variable", editCount)

                }

                if (product.productType === "variation") {

                    const existing = res.rows[0];
                    const productId = existing.productId

                    const rp = product.regularPrice ?? "";
                    const rawRegularPrice = typeof rp === "string"
                        ? rp.split(",").map(s => safeTrim(s))
                        : [];
                    const regularPrice = arrayToJson(rawRegularPrice);

                    const sp = product.salePrice ?? "";
                    const rawSalePrice = typeof sp === "string"
                        ? sp.split(",").map(s => safeTrim(s))
                        : [];
                    const salePrice = arrayToJson(rawSalePrice);

                    const ct = product.cost ?? "";
                    const rawCost = typeof ct === "string"
                        ? ct.split(",").map(s => safeTrim(s))
                        : [];
                    const cost = arrayToJson(rawCost);

                    // start with the timestamp
                    const updatePayload: Record<string, any> = {
                        updatedAt: new Date(),
                    };
                    const columnExists = (col: string) => headerRow.includes(col);

                    if (columnExists("regularPrice") && product.regularPrice && safeTrim(product.regularPrice) !== "") {
                        updatePayload.regularPrice = regularPrice;
                    }

                    if (columnExists("salePrice") && product.salePrice && safeTrim(product.salePrice) !== "") {
                        updatePayload.salePrice = salePrice;
                    }

                    if (columnExists("cost") && product.cost && safeTrim(product.cost) !== "") {
                        updatePayload.cost = cost;
                    }

                    // now run the update
                    try {
                        await db
                            .updateTable("productVariations")
                            .set(updatePayload)
                            .where("id", "=", existing.id)
                            .execute();
                    } catch (opErr: any) {
                        rowErrors.push({
                            row: rowNumber,
                            error: `Failed to update product ${lookUpValue}: ${opErr.message}`,
                        });
                        // skip further operations on this row
                        throw opErr;
                    }

                    let newWarehouse = false
                    const checkWarehouse = (product.warehouseId && product.warehouseId !== "")
                    const checkCountries = (product.countries && product.countries !== "")
                    const checkStock = (product.stock && product.stock !== "")
                    if (checkWarehouse && checkCountries && checkStock) {
                        newWarehouse = true
                    }

                    if (newWarehouse) {
                        const countries = product.countries
                        const countryArray = countries
                            .split(",")
                            .map(s => safeTrim(s));
                        console.log(countryArray, existing.id, productId)
                        if (countryArray.length === 0) countryArray.push(countries)
                        const warehouseId = product.warehouseId

                        const stocks = (product.stock).toString()
                        const stockArray = stocks
                            .split(",")
                            .map(s => safeTrim(s));
                        if (stockArray.length === 0) stockArray.push(stocks)

                        for (let i = 0; i < countryArray.length; i++) {
                            await db.updateTable("warehouseStock")
                                .set({ quantity: stockArray[i] })
                                .where("country", "=", countryArray[i])
                                .where("productId", "=", productId)
                                .where("variationId", "=", existing.id)
                                .where("warehouseId", "=", warehouseId)
                                .execute()
                        }
                    }
                    editCount++
                    console.log("variation", editCount)
                }
            }
        }
        return NextResponse.json({ rowCount: data.length, successCount, editCount }, { status: 201 });
    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ rowErrors }, { status: 500 });
    }
}