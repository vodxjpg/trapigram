// app/api/product/import/route.ts
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getContext } from "@/lib/context";
import { v4 as uuidv4 } from "uuid";
import * as XLSX from "xlsx";
import sanitizeHtml from "sanitize-html";

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

            const rawCategories = product.categories
            const categories = eval(`(${rawCategories})`)

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
            const rawRegularPrice = product.regularPrice
            const regularPrice = eval(`(${rawRegularPrice})`)

            const rawSalePrice = product.salePrice
            const salePrice = eval(`(${rawSalePrice})`)

            const rawCost = product.cost
            const cost = eval(`(${rawCost})`)

            const safeDescription = cleanDescription(product.description);

            await db.insertInto("products").values({
                id: productId,
                organizationId,
                tenantId,
                title: product.title,
                description: safeDescription,
                image: null,
                sku: finalSku,
                status: "published",
                productType: "simple",
                regularPrice: regularPrice,
                salePrice: salePrice,
                cost: cost ?? {},
                allowBackorders: false,
                manageStock: true,
                stockStatus: "managed",
                createdAt: new Date(),
                updatedAt: new Date(),
            }).execute()

            const warehouseStock: WarehouseStockEntry[] = [];
            for (let i = 1; i <= 10; i++) {
                const wKey = `warehouseId${i}`
                const cKey = `country${i}`
                const qKey = `quantity${i}`
                if (product[wKey]) {
                    warehouseStock.push({
                        warehouseId: product[wKey],
                        productId,
                        variationId: null,
                        country: product[cKey],
                        quantity: product[qKey]
                    })
                }
            }

            if (warehouseStock?.length) {

                for (const entry of warehouseStock) {

                    await db.insertInto("warehouseStock").values({
                        id: uuidv4(),
                        warehouseId: entry.warehouseId,
                        productId,                        // ← use the local const `productId`
                        variationId: entry.variationId,
                        country: entry.country,
                        quantity: entry.quantity,
                        organizationId,
                        tenantId,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    }).execute()

                }
            }

            if (categories?.length) {
                for (const cid of categories) {
                    await db.insertInto("productCategory").values({ productId, categoryId: cid }).execute()
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
