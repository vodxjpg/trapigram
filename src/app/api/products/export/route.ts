// src/app/api/products/export/route.ts
import { pgPool as pool } from "@/lib/db";
import { NextResponse, after } from "next/server";
import * as XLSX from "xlsx";
import { sendEmail } from "@/lib/email";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

const EMAIL_EXPORT_THRESHOLD = 20;

interface Grouped {
    warehouseId: string;
    stockMap: Record<string, number>;
}

type ExportQuery = {
    search: string;
    status?: "published" | "draft";
    categoryId?: string;
    attributeTermId?: string;
    orderBy: "createdAt" | "updatedAt" | "title" | "sku";
    orderDir: "asc" | "desc";
};

/** Fetch a single page from your own listing API, forwarding auth headers */
async function fetchListPage(
    origin: string,
    headers: Headers,
    q: ExportQuery,
    page: number,
    pageSize: number
) {
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    if (q.search) params.set("search", q.search);
    if (q.status) params.set("status", q.status);
    if (q.categoryId) params.set("categoryId", q.categoryId);
    if (q.attributeTermId) params.set("attributeTermId", q.attributeTermId);
    params.set("orderBy", q.orderBy);
    params.set("orderDir", q.orderDir);

    const res = await fetch(`${origin}/api/products?${params.toString()}`, {
        method: "GET",
        headers,
        cache: "no-store",
    });

    if (!res.ok) {
        throw new Error(`Failed to fetch products page ${page}: ${await res.text()}`);
    }
    return res.json() as Promise<{
        products: any[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
    }>;
}

/** Build the flat list consumed by XLSX from the list of products */
async function buildExportRows(products: any[]) {
    const newProductList: any[] = [];

    for (const prt of products) {
        const newProduct: any = {};
        newProduct.id = prt.id;
        newProduct.sku = prt.sku;
        newProduct.title = prt.title;
        newProduct.published = prt.status === "published" ? 1 : 0;
        newProduct.parent = "";

        const categories: string[] = [];
        for (const cat of prt.categories || []) {
            const catQuery = `SELECT slug FROM "productCategories" WHERE id='${cat}'`;
            const catResult = await pool.query(catQuery);
            const result = catResult.rows[0];
            if (result?.slug) categories.push(result.slug);
        }
        newProduct.categories = categories.join(", ");

        const productQuery = `SELECT "productType", description, "allowBackorders", "manageStock", "regularPrice", "salePrice", cost FROM products WHERE id='${prt.id}'`;
        const productResult = await pool.query(productQuery);
        const result = productResult.rows[0];
        newProduct.productType = result.productType;
        newProduct.description = result.description;
        newProduct.allowBackorders = result.allowBackorders === true ? 1 : 0;
        newProduct.manageStock = result.manageStock === true ? 1 : 0;

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
      WHERE pav."productId" = '${prt.id}'`;
        const attributesResult = await pool.query(attributesQuery);
        const resultAttr = attributesResult.rows;

        const map = resultAttr.reduce((acc: Record<string, { productId: string; attributeSlug: string; termSlugs: string[] }>, { productId, attributeSlug, termSlug }: any) => {
            const key = `${productId}|${attributeSlug}`;
            if (!acc[key]) acc[key] = { productId, attributeSlug, termSlugs: [] };
            acc[key].termSlugs.push(termSlug);
            return acc;
        }, {});
        const groupedAttr = Object.values(map).map(({ productId, attributeSlug, termSlugs }) => ({
            productId,
            attributeSlug,
            termSlug: termSlugs.join(", "),
        }));

        for (let i = 0; i < groupedAttr.length; i++) {
            newProduct[`attributeSlug${i + 1}`] = groupedAttr[i].attributeSlug;
            newProduct[`attributeValues${i + 1}`] = groupedAttr[i].termSlug;
            newProduct[`attributeVariation${i + 1}`] = "";
        }

        const warehouseQuery = `SELECT "productId", "warehouseId", country, quantity FROM "warehouseStock" WHERE "productId"='${prt.id}' AND "variationId" IS NULL`;
        const warehouseResult = await pool.query(warehouseQuery);
        const resultWarehouse = warehouseResult.rows;

        const groups = resultWarehouse.reduce<Record<string, Grouped>>((acc, { warehouseId, country, quantity }: any) => {
            if (!acc[warehouseId]) acc[warehouseId] = { warehouseId, stockMap: {} };
            acc[warehouseId].stockMap[country] = quantity;
            return acc;
        }, {});
        const groupedWarehouses = Object.values(groups).map(({ warehouseId, stockMap }) => {
            const countries = Object.keys(stockMap).join(", ");
            const stock = Object.values(stockMap).join(", ");
            return { warehouseId, countries, stock };
        });

        for (const w of groupedWarehouses) {
            const productCopy = { ...newProduct };
            productCopy.warehouseId = w.warehouseId;
            productCopy.countries = w.countries;
            productCopy.stock = w.stock;
            newProductList.push(productCopy);
        }
        if (groupedWarehouses.length === 0) newProductList.push({ ...newProduct });
    }

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
        manageStock: p.manageStock,
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

    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });

    return { buf, rowCount: worksheetData.length };
}

export async function POST(request: Request) {
    const session = await auth.api.getSession({ headers: request.headers });

    try {
        const body = await request.json();
        const userEmail = session?.user.email;

        const exportAll: boolean = Boolean(body.exportAll);
        const query: ExportQuery | undefined = body.query;

        let products: any[] = [];

        // --- Branch A: exportAll → decide early if we should queue background work
        if (exportAll) {
            if (!query) {
                return NextResponse.json(
                    { error: "Missing query for exportAll" },
                    { status: 400 }
                );
            }

            const origin = new URL(request.url).origin;
            const headers = new Headers(request.headers);

            // 1) Make a tiny request to learn the total FIRST (cheap)
            const first = await fetchListPage(origin, headers, query, 1, 1);
            const total = Number(first?.pagination?.total ?? 0);

            // 2) If big export → respond immediately, process in background
            if (total > EMAIL_EXPORT_THRESHOLD && userEmail) {
                // Tell the UI right away
                after(async () => {
                    try {
                        // Build the full product list by paging
                        const pageSize = 200;
                        const all: any[] = [];
                        // We already fetched page 1 (pageSize 1) to get total; now fetch in batches
                        const totalPages = Math.ceil(total / pageSize);
                        for (let page = 1; page <= totalPages; page++) {
                            const { products: pageProducts } = await fetchListPage(
                                origin,
                                headers,
                                query,
                                page,
                                pageSize
                            );
                            if (Array.isArray(pageProducts) && pageProducts.length) {
                                all.push(...pageProducts);
                            }
                        }

                        // Build workbook + email in background
                        const { buf } = await buildExportRows(all);
                        const base64File = Buffer.from(buf).toString("base64");
                        console.log(`Email sent to ${userEmail}`)
                        await sendEmail({
                            to: userEmail,
                            subject: "Your product export file",
                            text: "Please find attached your exported product data.",
                            html:
                                `<p>Hi! Your export is being processed and is now ready.</p>` +
                                `<p>We've attached the XLSX file.</p>` +
                                `<p>Thank you!</p><p>Trapyfy</p>`,
                            attachments: [
                                {
                                    filename: "products-export.xlsx",
                                    content: base64File,
                                },
                            ],
                        });
                    } catch (bgErr) {
                        console.error("[PRODUCTS_EXPORT_BG]", bgErr);
                        // Optional: you could notify admins here, or email a failure notice.
                    }
                });

                // Immediate response – UI can show the “sent to email” dialog now.
                return NextResponse.json({ sentToEmail: true, queued: true }, { status: 200 });
            }

            // 3) Small export → do it synchronously and return the file download
            // Build the full list synchronously (<= 50 rows outcome)
            const pageSize = 200;
            const all: any[] = [];
            const totalPages = Math.ceil(total / pageSize);
            for (let page = 1; page <= totalPages; page++) {
                const { products: pageProducts } = await fetchListPage(
                    origin,
                    headers,
                    query,
                    page,
                    pageSize
                );
                if (Array.isArray(pageProducts) && pageProducts.length) {
                    all.push(...pageProducts);
                }
            }
            products = all;
        } else {
            // --- Branch B: client-provided products (current page)
            const provided = Array.isArray(body.products) ? body.products : [];
            if (!provided.length) {
                return NextResponse.json(
                    { error: "No products provided for export" },
                    { status: 400 }
                );
            }

            // If big → queue background email and return immediately
            if (provided.length > EMAIL_EXPORT_THRESHOLD && userEmail) {
                after(async () => {
                    try {
                        const { buf } = await buildExportRows(provided);
                        const base64File = Buffer.from(buf).toString("base64");
                        await sendEmail({
                            to: userEmail,
                            subject: "Your product export file",
                            text: "Please find attached your exported product data.",
                            html:
                                `<p>Hi! Your export is being processed and is now ready.</p>` +
                                `<p>We've attached the XLSX file.</p>` +
                                `<p>Thank you!</p><p>Trapyfy</p>`,
                            attachments: [
                                {
                                    filename: "products-export.xlsx",
                                    content: base64File,
                                },
                            ],
                        });
                    } catch (bgErr) {
                        console.error("[PRODUCTS_EXPORT_BG(clientRows)]", bgErr);
                    }
                });

                return NextResponse.json({ sentToEmail: true, queued: true }, { status: 200 });
            }

            // Small → continue synchronously
            products = provided;
        }

        // --- Synchronous path (small exports): build and return the file directly
        if (!products.length) {
            return NextResponse.json(
                { error: "No products found for export" },
                { status: 400 }
            );
        }

        const { buf } = await buildExportRows(products);

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
