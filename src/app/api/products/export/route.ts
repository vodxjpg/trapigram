// src/app/api/products/export/route.ts
import { pgPool as pool } from "@/lib/db";
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

export const runtime = "nodejs";

interface Grouped {
    warehouseId: string
    stockMap: Record<string, number>
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const products = Array.isArray(body.products) ? body.products : [];
        console.log(products)

        // Validate data
        if (!products.length) {
            return NextResponse.json(
                { error: "No products provided for export" },
                { status: 400 }
            );
        }

        const newProductList: [] = []

        for (const prt of products) {
            const newProduct = {}
            newProduct.id = prt.id
            newProduct.sku = prt.sku
            newProduct.title = prt.title
            newProduct.published = prt.status === "published" ? 1 : 0
            newProduct.parent = ""

            const categories: [] = []

            for (const cat of prt.categories) {
                const catQuery = `SELECT slug FROM "productCategories" WHERE id='${cat}'`
                const catResult = await pool.query(catQuery)
                const result = catResult.rows[0]
                categories.push(result.slug)
            }
            newProduct.categories = categories.join(", ")

            const productQuery = `SELECT "productType", description, "allowBackorders", "manageStock", "regularPrice", "salePrice", cost FROM products WHERE id='${prt.id}'`
            const productResult = await pool.query(productQuery)
            const result = productResult.rows[0]
            newProduct.productType = result.productType
            newProduct.description = result.description
            newProduct.allowBackorders = result.allowBackorders === true ? 1 : 0
            newProduct.manageStock = result.manageStock === true ? 1 : 0

            const regularPriceObj = result.regularPrice ?? {};
            const salePriceObj = result.salePrice ?? {};
            const costObj = result.cost ?? {};

            newProduct.regularPrice = Object.entries(regularPriceObj)
                .map(([country, amount]) => `${country}:${amount}`)
                .join(", ");
            newProduct.salePrice = Object.entries(salePriceObj)
                .map(([country, amount]) => `${country}:${amount}`)
                .join(", ");
            newProduct.cost = Object.entries(costObj)
                .map(([country, amount]) => `${country}:${amount}`)
                .join(", ");

            const attributesQuery = `SELECT
                pav."productId",
                pa."slug"  AS "attributeSlug",
                pat."slug" AS "termSlug"
                FROM "productAttributeValues" pav
                JOIN "productAttributes"      pa  ON pav."attributeId" = pa."id"
                JOIN "productAttributeTerms"  pat ON pav."termId"       = pat."id"
                WHERE pav."productId" = '${prt.id}'`
            const attributesResult = await pool.query(attributesQuery)
            const resultAttr = attributesResult.rows

            // reduce into a map keyed by product+attribute
            const map = resultAttr.reduce((acc, { productId, attributeSlug, termSlug }) => {
                const key = `${productId}|${attributeSlug}`
                if (!acc[key]) {
                    acc[key] = { productId, attributeSlug, termSlugs: [] }
                }
                acc[key].termSlugs.push(termSlug)
                return acc
            }, {} as Record<string, { productId: string; attributeSlug: string; termSlugs: string[] }>)

            const attr = Object.values(map)
            const groupedAttr = attr.map(({ productId, attributeSlug, termSlugs }) => ({
                productId,
                attributeSlug,
                termSlug: termSlugs.join(', ')
            }))
            console.log(groupedAttr)

            for (let i = 0; i < groupedAttr.length; i++) {
                newProduct[`attributeSlug${i + 1}`] = groupedAttr[i].attributeSlug
                newProduct[`attributeValues${i + 1}`] = groupedAttr[i].termSlug
                newProduct[`attributeVariation${i + 1}`] = ""
            }

            const warehouseQuery = `SELECT "productId", "warehouseId", country, quantity FROM "warehouseStock" WHERE "productId"='${prt.id}' AND "variationId" IS NULL`
            const warehouseResult = await pool.query(warehouseQuery)
            const resultWarehouse = warehouseResult.rows

            const groups = resultWarehouse.reduce<Record<string, Grouped>>((acc, { productId, warehouseId, country, quantity }) => {
                if (!acc[warehouseId]) {
                    acc[warehouseId] = { productId, warehouseId, stockMap: {} }
                }
                acc[warehouseId].stockMap[country] = quantity
                return acc
            }, {})

            const groupedWarehouses = Object.values(groups).map(({ productId, warehouseId, stockMap }) => {
                const countries = Object.keys(stockMap).join(", ")
                const stock = Object.values(stockMap).join(", ")
                return { productId, warehouseId, countries, stock }
            })

            for (const warehouse of groupedWarehouses) {
                // Create a deep copy of newProduct to avoid mutating the same object
                const productCopy = { ...newProduct };

                // Add warehouse-specific fields
                productCopy.warehouseId = warehouse.warehouseId;
                productCopy.countries = warehouse.countries;
                productCopy.stock = warehouse.stock;

                // Push the modified product copy to newProductList
                newProductList.push(productCopy);
            }

            if (groupedWarehouses.length === 0) {
                newProductList.push({ ...newProduct });
            }
        }

        // Prepare worksheet rows
        const worksheetData = newProductList.map((p: any) => ({
            id: p.id,
            sku: p.sku,
            title: p.title,
            published: p.published,
            productType: p.productType,
            parent: p.parent || "",
            description: p.description,
            categories: p.categories,
            regularPrice: p.regularPrice,
            salePrice: p.salePrice,
            cost: p.cost,
            managedStock: p.manageStock,
            backorder: p.allowBackorders,
            warehouseId: p.warehouseId,
            countries: p.countries,
            stock: p.stock,
            attributeSlug1: p.attributeSlug1 || "",
            attributeValues1: p.attributeValues1 || "",
            attributeVariation1: p.attributeVariation1 || "",
            attributeSlug2: p.attributeSlug2 || "",
            attributeValues2: p.attributeValues2 || "",
            attributeVariation2: p.attributeVariation2 || "",
            attributeSlug3: p.attributeSlug3 || "",
            attributeValues3: p.attributeValues3 || "",
            attributeVariation3: p.attributeVariation3 || "",
            attributeSlug4: p.attributeSlug4 || "",
            attributeValues4: p.attributeValues4 || "",
            attributeVariation4: p.attributeVariation4 || "",
            attributeSlug5: p.attributeSlug5 || "",
            attributeValues5: p.attributeValues5 || "",
            attributeVariation5: p.attributeVariation5 || "",
        }));

        // Build workbook
        const ws = XLSX.utils.json_to_sheet(worksheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Products");
        const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });

        // Return as downloadable file
        return new Response(Buffer.from(buf), {
            status: 200,
            headers: {
                "Content-Type":
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "Content-Disposition": `attachment; filename="products-export.xlsx"`,
            },
        });
    } catch (err: any) {
        return NextResponse.json(
            { error: err.message ?? "Export failed" },
            { status: 500 }
        );
    }
}
