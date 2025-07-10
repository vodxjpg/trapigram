// app/api/product/import/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import * as XLSX from "xlsx";
import sanitizeHtml from "sanitize-html";
import { pgPool } from "@/lib/db";

// Run this route in Node.js so that Buffer, FormData.arrayBuffer(), etc. work
export const runtime = "nodejs";

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

type CategoryEntry = {
    id: string
}

type VariationEntry = {
    id: string,
    name: string,
    terms: string,
}

function capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

const arrayToJson = (arr) =>
    arr.reduce((acc, pair) => {
        const [key, value] = pair.split(":").map((s) => s.trim());
        acc[key] = Number(value);
        return acc;
    }, {});

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
    const [headerRow, /* skip */, ...dataRows] = rows;

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
            const rowNumber = i + 3; // header + skipped row
            console.log(product.id)

            let productId = product.id
            const productSku = product.sku
            const productQuery = `SELECT * FROM products WHERE id = '${productId}' OR sku ='${productSku}'`
            const productResult = await pgPool.query(productQuery)

            if (productResult.rows.length > 0) {
                //Update product code
                console.log("UPDATING" + product.id)
                // --- UPDATE product ---
                const existing = productResult.rows[0];
                productId = existing.id
                const safeDescription = cleanDescription(product.description);

                const rp = product.regularPrice
                const rawRegularPrice = rp
                    .split(",")
                    .map(s => s.trim());
                const regularPrice = arrayToJson(rawRegularPrice)

                const sp = product.salePrice
                const rawSalePrice = sp
                    .split(",")
                    .map(s => s.trim());
                const salePrice = arrayToJson(rawSalePrice)

                const ct = product.cost
                const rawCost = ct
                    .split(",")
                    .map(s => s.trim());
                const cost = arrayToJson(rawCost)

                // update core product fields
                await db
                    .updateTable("products")
                    .set({
                        title: product.title,
                        description: safeDescription,
                        sku: product.sku || existing.sku,
                        status: product.published === 1 ? "published" : "draft",
                        productType: product.productType,
                        regularPrice,
                        salePrice,
                        cost,
                        updatedAt: new Date(),
                    })
                    .where("id", "=", existing.id)
                    .execute();

                // clear old categories and values
                await db.deleteFrom("productCategory").where("productId", "=", existing.id).execute();
                await db.deleteFrom("productAttributeValues").where("productId", "=", existing.id).execute();
                await db.deleteFrom("warehouseStock").where("productId", "=", existing.id).execute();
                await db.deleteFrom("productVariations").where("productId", "=", existing.id).execute();

                const categories: CategoryEntry[] = [];

                const slugs = product.categories
                const catArray = slugs
                    .split(",")
                    .map(s => s.trim());

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

                if (product.productType === "simple") {
                    const countries = product.countries
                    const countryArray = countries
                        .split(",")
                        .map(s => s.trim());

                    const stocks = product.stock
                    const stockArray = stocks
                        .split(",")
                        .map(s => s.trim());

                    const variations: VariationEntry[] = [];

                    for (let i = 1; i <= 2; i++) {

                        if (product[`attributeVariation${i}`] !== "" && product[`attributeVariation${i}`] === 0) {
                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => s.trim());

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
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
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""
                                const obj = {}

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id
                                    obj[nameId] = termId
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId
                                }


                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }
                    }

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

                    for (const vari of variations) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: vari.name, termId: vari.terms[vari.name] })
                            .execute()
                    }
                }

                if (product.productType === "variable") {
                    const countries = product.countries
                    const countryArray = countries
                        .split(",")
                        .map(s => s.trim());

                    const stocks = product.stock
                    const stockArray = stocks
                        .split(",")
                        .map(s => s.trim());

                    const variations: VariationEntry[] = [];

                    for (let i = 1; i <= 2; i++) {

                        if (product[`attributeVariation${i}`] !== "" && product[`attributeVariation${i}`] === 1) {

                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => s.trim());

                            let nameId = ""

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
                            const nameResult = await pgPool.query(nameQuery)

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
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""
                                const obj = {}

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id
                                    obj[nameId] = termId
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId
                                }

                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }
                    }

                    for (const vari of variations) {
                        await db.insertInto("productVariations").values({
                            id: vari.id,
                            productId,
                            attributes: vari.terms,
                            sku: `SKU-${uuidv4().slice(0, 8)}`,
                            image: null,
                            regularPrice,
                            salePrice,
                            cost: cost ?? {},
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }).execute()
                    }

                    for (const vari of variations) {
                        for (let i = 0; i < countryArray.length; i++) {
                            await db.insertInto("warehouseStock").values({
                                id: uuidv4(),
                                warehouseId: product.warehouseId,
                                productId,                        // ← use the local const `productId`
                                variationId: vari.id,
                                country: countryArray[i],
                                quantity: stockArray[i],
                                organizationId,
                                tenantId,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            }).execute()
                        }
                    }

                    for (const vari of variations) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: vari.name, termId: vari.terms[vari.name] })
                            .execute()
                    }

                }

                if (categories?.length) {
                    for (const cid of categories) {
                        await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                    }
                }
                editCount++
            }

            if (productResult.rows.length === 0) {
                //creation product code
                console.log("CREATING")
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
                    .map(s => s.trim());

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

                const rp = product.regularPrice
                const rawRegularPrice = rp
                    .split(",")
                    .map(s => s.trim());
                const regularPrice = arrayToJson(rawRegularPrice)

                const sp = product.salePrice
                const rawSalePrice = sp
                    .split(",")
                    .map(s => s.trim());
                const salePrice = arrayToJson(rawSalePrice)

                const ct = product.cost
                const rawCost = ct
                    .split(",")
                    .map(s => s.trim());
                const cost = arrayToJson(rawCost)

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
                    allowBackorders: false,
                    manageStock: true,
                    stockStatus: "managed",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }).execute()

                if (product.productType === "simple") {
                    const countries = product.countries
                    const countryArray = countries
                        .split(",")
                        .map(s => s.trim());

                    const stocks = product.stock
                    const stockArray = stocks
                        .split(",")
                        .map(s => s.trim());

                    const variations: VariationEntry[] = [];

                    for (let i = 1; i <= 2; i++) {

                        if (product[`attributeVariation${i}`] !== "" && product[`attributeVariation${i}`] === 0) {
                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => s.trim());

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
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
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""
                                const obj = {}

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id
                                    obj[nameId] = termId
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId
                                }


                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }
                    }

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

                    for (const vari of variations) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: vari.name, termId: vari.terms[vari.name] })
                            .execute()
                    }
                }

                if (product.productType === "variable") {
                    const countries = product.countries
                    const countryArray = countries
                        .split(",")
                        .map(s => s.trim());

                    const stocks = product.stock
                    const stockArray = stocks
                        .split(",")
                        .map(s => s.trim());

                    const variations: VariationEntry[] = [];

                    for (let i = 1; i <= 2; i++) {

                        if (product[`attributeVariation${i}`] !== "" && product[`attributeVariation${i}`] === 1) {

                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => s.trim());

                            let nameId = ""

                            const name = product[`attributeSlug${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
                            const nameResult = await pgPool.query(nameQuery)

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
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)

                                let termId = ""
                                const obj = {}

                                if (nameResult.rows.length > 0) {
                                    termId = nameResult.rows[0].id
                                    obj[nameId] = termId
                                }

                                if (nameResult.rows.length === 0) {
                                    const attTerm = capitalizeFirstLetter(t)
                                    termId = uuidv4()
                                    const newAttQuery = `INSERT INTO "productAttributeTerms"(id, "attributeId", name, slug, "organizationId", "createdAt", "updatedAt")
                                        VALUES ('${termId}', '${nameId}', '${attTerm}', '${t}', '${organizationId}', NOW(), NOW())
                                        RETURNING *`

                                    await pgPool.query(newAttQuery)
                                    obj[nameId] = termId
                                }

                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }
                    }

                    for (const vari of variations) {
                        await db.insertInto("productVariations").values({
                            id: vari.id,
                            productId,
                            attributes: vari.terms,
                            sku: `SKU-${uuidv4().slice(0, 8)}`,
                            image: null,
                            regularPrice,
                            salePrice,
                            cost: cost ?? {},
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        }).execute()
                    }

                    for (const vari of variations) {
                        for (let i = 0; i < countryArray.length; i++) {
                            await db.insertInto("warehouseStock").values({
                                id: uuidv4(),
                                warehouseId: product.warehouseId,
                                productId,                        // ← use the local const `productId`
                                variationId: vari.id,
                                country: countryArray[i],
                                quantity: stockArray[i],
                                organizationId,
                                tenantId,
                                createdAt: new Date(),
                                updatedAt: new Date(),
                            }).execute()
                        }
                    }

                    for (const vari of variations) {
                        await db.insertInto("productAttributeValues")
                            .values({ productId, attributeId: vari.name, termId: vari.terms[vari.name] })
                            .execute()
                    }

                }

                if (categories?.length) {
                    for (const cid of categories) {
                        await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
                    }
                }

                successCount++
            }
        }
        return NextResponse.json({ rowCount: data.length, successCount, editCount }, { status: 201 });
    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ error: err.message || err.toString() }, { status: 500 });
    }
}