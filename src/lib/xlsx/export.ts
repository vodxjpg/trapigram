// lib/xlsx/export.ts
import * as XLSX from "xlsx";

/**
 * Types describing minimal shapes returned by SQL. We keep them structural to avoid
 * coupling to your Kysely table types here.
 */
type ProductRow = {
    productId?: string; // alias
    id: string;
    sku: string;
    title: string;
    status: "published" | "draft";
    productType: "simple" | "variable";
    regularPrice: Record<string, number>;
    salePrice: Record<string, number> | null;
    cost: Record<string, number>;
    manageStock: boolean;
    backorder: boolean;
};

type CategoryRow = {
    productId: string;
    categoryId: string;
};

type PAVRow = {
    productId: string;
    attrSlug: string;
    termSlug: string;
};

type VariationRow = {
    variationId: string;
    productId: string;
    sku: string;
    attributes: Record<string, string>; // attributeId -> termId
    regularPrice: Record<string, number>;
    salePrice: Record<string, number> | null;
    cost: Record<string, number>;
};

type StockRow = {
    productId: string | null;
    variationId: string | null;
    warehouseId: string;
    country: string;
    quantity: number;
};

export async function buildExportWorkbook(input: {
    products: ProductRow[];
    categories: CategoryRow[];
    productAttributeValues: PAVRow[];
    variations: VariationRow[];
    stock: StockRow[];
}): Promise<{ buffer: Buffer; tooMany: boolean }> {
    const {
        products,
        categories,
        productAttributeValues,
        variations,
        stock,
    } = input;

    const catMap = new Map<string, string[]>(); // productId -> [categoryIds]
    for (const r of categories) {
        if (!catMap.has(r.productId)) catMap.set(r.productId, []);
        catMap.get(r.productId)!.push(r.categoryId);
    }

    const pavMap = new Map<string, { attrs: string[]; terms: string[] }>(); // productId -> aligned slugs
    for (const r of productAttributeValues) {
        if (!pavMap.has(r.productId)) pavMap.set(r.productId, { attrs: [], terms: [] });
        const entry = pavMap.get(r.productId)!;
        entry.attrs.push(r.attrSlug);
        entry.terms.push(r.termSlug);
    }

    const varByProduct = new Map<string, VariationRow[]>();
    for (const v of variations) {
        if (!varByProduct.has(v.productId)) varByProduct.set(v.productId, []);
        varByProduct.get(v.productId)!.push(v);
    }

    // Build a stock index keyed by (productId or variationId)
    const stockByKey = new Map<string, StockRow[]>();
    for (const s of stock) {
        const key = s.variationId ? `v:${s.variationId}` : `p:${s.productId}`;
        if (!stockByKey.has(key)) stockByKey.set(key, []);
        stockByKey.get(key)!.push(s);
    }

    const outRows: Record<string, any>[] = [];

    for (const p of products) {
        const base = {
            id: p.id,
            sku: p.sku,
            title: p.title,
            published: p.status === "published" ? 1 : 0,
            productType: p.productType,
            parent: "",
            categories: (catMap.get(p.id) ?? []).join(","),
            regularPrice: JSON.stringify(p.regularPrice ?? {}),
            salePrice: p.salePrice ? JSON.stringify(p.salePrice) : "",
            cost: JSON.stringify(p.cost ?? {}),
            manageStock: p.manageStock ? 1 : 0,
            backorder: p.backorder ? 1 : 0,
            attribute_slugs: (pavMap.get(p.id)?.attrs ?? []).join(","),
            term_slugs: (pavMap.get(p.id)?.terms ?? []).join(","),
            variation_attributes: "",
        };

        const productStocks = stockByKey.get(`p:${p.id}`) ?? [];
        if (productStocks.length === 0) {
            outRows.push({
                ...base,
                warehouseId: "",
                country: "",
                stock: "",
            });
        } else {
            for (const s of productStocks) {
                outRows.push({
                    ...base,
                    warehouseId: s.warehouseId,
                    country: s.country,
                    stock: s.quantity,
                });
            }
        }

        // Variations
        if (p.productType === "variable") {
            const vs = varByProduct.get(p.id) ?? [];
            for (const v of vs) {
                const varBase = {
                    id: v.variationId,
                    sku: v.sku,
                    title: p.title, // export parent title (variation can hold its own if you want to change this)
                    published: p.status === "published" ? 1 : 0,
                    productType: "variable" as const,
                    parent: p.id,
                    categories: (catMap.get(p.id) ?? []).join(","), // same categories as parent
                    regularPrice: JSON.stringify(v.regularPrice ?? {}),
                    salePrice: v.salePrice ? JSON.stringify(v.salePrice) : "",
                    cost: JSON.stringify(v.cost ?? {}),
                    manageStock: p.manageStock ? 1 : 0, // often managed at parent; adapt if needed
                    backorder: p.backorder ? 1 : 0,
                    attribute_slugs: (pavMap.get(p.id)?.attrs ?? []).join(","),
                    term_slugs: (pavMap.get(p.id)?.terms ?? []).join(","),
                    variation_attributes: JSON.stringify(v.attributes ?? {}),
                };
                const varStocks = stockByKey.get(`v:${v.variationId}`) ?? [];
                if (varStocks.length === 0) {
                    outRows.push({
                        ...varBase,
                        warehouseId: "",
                        country: "",
                        stock: "",
                    });
                } else {
                    for (const s of varStocks) {
                        outRows.push({
                            ...varBase,
                            warehouseId: s.warehouseId,
                            country: s.country,
                            stock: s.quantity,
                        });
                    }
                }
            }
        }
    }

    const header = [
        "id",
        "sku",
        "title",
        "published",
        "productType",
        "parent",
        "categories",
        "regularPrice",
        "salePrice",
        "cost",
        "manageStock",
        "backorder",
        "warehouseId",
        "country",
        "stock",
        "attribute_slugs",
        "term_slugs",
        "variation_attributes",
    ];

    const ws = XLSX.utils.json_to_sheet(outRows, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Products");
    const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const tooMany = outRows.length > 50;
    return { buffer, tooMany };
}
