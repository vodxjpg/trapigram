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

type WarehouseStockEntry = {
    warehouseId: string;
    productId: string;
    variationId: string | null;  // nullable if you don’t always have a variation
    country: string;
    quantity: number;
};

type CategoryEntry = {
    id: string
}

type VariationEntry = {
    id: string,
    name: string,
    terms: string,
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
    try {

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
                obj[colName] = row[idx];
            });
            return obj;
        });

        const tenant = await db.selectFrom("tenant").select("id").where("ownerUserId", "=", userId).executeTakeFirst()
        if (!tenant) return NextResponse.json({ error: "No tenant found for user" }, { status: 404 })
        const tenantId = tenant.id

        for (const product of data) {

            if (product.id !== "") {
                console.log("CHAO" + product.id)
            } else {
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
                    if (exists) return NextResponse.json({ error: "SKU already exists" }, { status: 400 })
                }

                const slugs = product.categories
                const catArray = slugs
                    .split(",")
                    .map(s => s.trim());

                const categories: CategoryEntry[] = [];

                for (const cat of catArray) {
                    const catQuery = `SELECT id FROM "productCategories" WHERE slug = '${cat}' AND "organizationId" = '${organizationId}'`
                    const catResult = await pgPool.query(catQuery)
                    categories.push(catResult.rows[0].id)
                }
                //const rawCategories = product.categories
                //const categories = eval(`(${rawCategories})`)

                /* category validation */
                if (categories?.length) {
                    const validIds = (await db.selectFrom("productCategories")
                        .select("id")
                        .where("organizationId", "=", organizationId)
                        .execute()).map(c => c.id)
                    const bad = categories.filter(id => !validIds.includes(id))
                    if (bad.length)
                        return NextResponse.json({ error: `Invalid category IDs: ${bad.join(", ")}` }, { status: 400 })
                }

                const productId = uuidv4()

                const rp = product.regularPrice
                const rawRegularPrice = rp
                    .split(",")
                    .map(s => s.trim());
                //const regularPrice = eval(`(${rawRegularPrice})`)
                const regularPrice = arrayToJson(rawRegularPrice)

                const sp = product.salePrice
                const rawSalePrice = sp
                    .split(",")
                    .map(s => s.trim());
                //const salePrice = eval(`(${rawSalePrice})`)
                const salePrice = arrayToJson(rawSalePrice)

                const ct = product.cost
                const rawCost = ct
                    .split(",")
                    .map(s => s.trim());
                //const cost = eval(`(${rawCost})`)
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

                    for (let i = 0; i < countryArray.length; i++) {

                        const variations: VariationEntry[] = [];

                        if (product[`attributeVariation${i}`] !== "" && product[`attributeVariation${i}`] === 0) {
                            const terms = product[`attributeValues${i}`]
                            const termsArray = terms
                                .split(",")
                                .map(s => s.trim());

                            const name = product[`attributeName${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
                            const nameResult = await pgPool.query(nameQuery)
                            const nameId = nameResult.rows[0].id

                            for (const t of termsArray) {
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)
                                const id = nameResult.rows[0].id
                                const obj = {}
                                obj[nameId] = id

                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }

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

                        for (const vari of variations) {
                            await db.insertInto("productAttributeValues")
                                .values({ productId, attributeId: vari.name, termId: vari.terms[vari.name] })
                                .execute()
                        }

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

                            const name = product[`attributeName${i}`]
                            const nameQuery = `SELECT id FROM "productAttributes" WHERE slug = '${name}'`
                            const nameResult = await pgPool.query(nameQuery)
                            const nameId = nameResult.rows[0].id

                            for (const t of termsArray) {
                                const nameQuery = `SELECT id FROM "productAttributeTerms" WHERE slug = '${t}'`
                                const nameResult = await pgPool.query(nameQuery)
                                const id = nameResult.rows[0].id
                                const obj = {}
                                obj[nameId] = id

                                variations.push({
                                    id: uuidv4(),
                                    name: nameId,
                                    terms: obj
                                })
                            }
                        }
                        console.log(variations)
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
            }
        }

        return NextResponse.json({
            sheetName: firstSheetName,
            rows: data,
            rowCount: data.length,
        });

    } catch (err: any) {
        console.error("Import XLSX error:", err);
        return NextResponse.json({ error: err.message || err.toString() }, { status: 500 });
    }
}
