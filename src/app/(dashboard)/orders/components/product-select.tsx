// components/ProductSelect.tsx
"use client";

import Image from "next/image";
import { Package, Minus, Plus, Trash2, Search } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    SelectGroup,
    SelectLabel,
    SelectSeparator,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
import { useState } from "react";

/** Local copies of small helpers so the component is self-contained */
const tokenOf = (p: Product) => `${p.id}:${p.variationId ?? "base"}`;
const parseToken = (t: string) => {
    const [productId, v] = String(t).split(":");
    return { productId, variationId: v === "base" ? null : v };
};
const inCartQty = (
    pid: string,
    vid: string | null,
    items: OrderItem[] = []
) =>
    items.reduce(
        (sum, it) =>
            sum +
            (it.product.id === pid &&
                (it.product.variationId ?? null) === (vid ?? null)
                ? it.quantity
                : 0),
        0
    );
const stockForCountry = (p: Product, country: string): number =>
    Object.values(p.stockData || {}).reduce(
        (sum, wh: any) => sum + (wh?.[country] ?? 0),
        0
    );

/** Utility: derive two-letter initials from a product title (fallback to SKU/id) */
function getInitials(input?: string) {
    const s = (input || "").trim();
    if (!s) return "PR";
    const words = s.split(/\s+/).filter(Boolean);
    const letters =
        words.length >= 2
            ? (words[0][0] + words[1][0])
            : words[0].slice(0, 2);
    return letters.toUpperCase();
}

/** Small inline component that renders an image with a graceful fallback */
function ProductImage({
    src,
    alt,
    size = 80,
    initials,
}: {
    src?: string;
    alt: string;
    size?: number;
    initials: string;
}) {
    const [failed, setFailed] = useState(false);

    if (!src || failed) {
        return (
            <div
                className="rounded-full bg-muted text-muted-foreground flex items-center justify-center font-semibold uppercase shrink-0"
                style={{ width: size, height: size }}
                aria-label={`${alt} placeholder`}
            >
                {initials}
            </div>
        );
    }

    return (
        <Image
            src={src}
            alt={alt}
            width={size}
            height={size}
            className="rounded-md shrink-0"
            onError={() => setFailed(true)}
        />
    );
}

/** Types aligned with the parent file */
export interface Product {
    id: string;
    variationId?: string | null;
    title: string;
    sku: string;
    description: string;
    regularPrice: Record<string, number>;
    price: number;
    image: string;
    stockData: Record<string, { [countryCode: string]: number }>;
    subtotal: number;
    allowBackorders?: boolean;
    isAffiliate?: boolean;
    categories?: string[];
}
export interface OrderItem {
    product: Product;
    quantity: number;
}

export interface ProductSelectProps {
    /** Gate the whole card (same visual/disabled semantics as before) */
    orderGenerated: boolean;

    /** Current cart lines and client country context */
    orderItems: OrderItem[];
    clientCountry: string;

    /** Stock errors from server when creating the order */
    stockErrors: Record<string, number>;

    /** Handlers preserved from parent */
    removeProduct: (
        productId: string,
        variationId: string | null,
        idx: number
    ) => void | Promise<void>;
    updateQuantity: (
        productId: string,
        variationId: string | null,
        action: "add" | "subtract"
    ) => void | Promise<void>;
    addProduct: () => void | Promise<void>;

    /** Product picker state (unchanged) */
    productsLoading: boolean;
    selectedProduct: string;
    prodTerm: string;
    setProdTerm: (v: string) => void;
    filteredProducts: Product[];
    prodResults: Product[];
    prodSearching: boolean;
    products: Product[];

    /** Parent helpers */
    pickProduct: (token: string, obj: Product) => void;
    groupByCategory: (arr: Product[]) => [string, Product[]][];

    /** Quantity input state (unchanged) */
    quantityText: string;
    setQuantityText: (v: string) => void;
    parseQty: (s: string) => number;
}

export default function ProductSelect(props: ProductSelectProps) {
    const {
        orderGenerated,
        orderItems,
        clientCountry,
        stockErrors,
        removeProduct,
        updateQuantity,
        addProduct,

        productsLoading,
        selectedProduct,
        prodTerm,
        setProdTerm,
        filteredProducts,
        prodResults,
        prodSearching,
        products,

        pickProduct,
        groupByCategory,

        quantityText,
        setQuantityText,
        parseQty,
    } = props;

    return (
        <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Package className="h-5 w-5" /> Product Selection
                </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
                {orderItems.length > 0 && (
                    <div className="space-y-4 mb-4">
                        {orderItems.map(({ product, quantity }, idx) => {
                            const price = product.price;
                            const finite = Object.keys(product.stockData || {}).length > 0;
                            const base = stockForCountry(product, clientCountry);
                            const used = inCartQty(
                                product.id,
                                product.variationId ?? null,
                                orderItems
                            );
                            const remaining = Math.max(0, base - used);
                            const disablePlus =
                                finite && !product.allowBackorders && remaining === 0;

                            const initials =
                                getInitials(product.title || product.sku || product.id);
                            return (
                                <div
                                    key={idx}
                                    className={
                                        "flex items-center gap-4 p-4 border rounded-lg" +
                                        (stockErrors[product.id] ? " border-red-500" : "")
                                    }
                                >
                                    {/* Image with graceful fallback to initials-in-circle */}
                                    <ProductImage
                                        src={product.image}
                                        alt={product.title}
                                        size={80}
                                        initials={initials}
                                    />

                                    <div className="flex-1">
                                        <div className="flex justify-between">
                                            <h3 className="font-medium">{product.title}</h3>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    removeProduct(
                                                        product.id,
                                                        product.variationId ?? null,
                                                        idx
                                                    )
                                                }
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            SKU: {product.sku}
                                        </p>
                                        <div
                                            className="text-sm"
                                            dangerouslySetInnerHTML={{
                                                __html: product.description,
                                            }}
                                        />
                                        <div className="flex items-center gap-2 mt-2">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    updateQuantity(
                                                        product.id,
                                                        product.variationId ?? null,
                                                        "subtract"
                                                    )
                                                }
                                            >
                                                <Minus className="h-4 w-4" />
                                            </Button>
                                            <span className="font-medium">{quantity}</span>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() =>
                                                    updateQuantity(
                                                        product.id,
                                                        product.variationId ?? null,
                                                        "add"
                                                    )
                                                }
                                                disabled={disablePlus}
                                                aria-disabled={disablePlus}
                                                title={disablePlus ? "Out of stock" : undefined}
                                            >
                                                <Plus className="h-4 w-4" />
                                            </Button>
                                        </div>

                                        {stockErrors[product.id] && (
                                            <p className="text-red-600 text-sm mt-1">
                                                Only {stockErrors[product.id]} available
                                            </p>
                                        )}

                                        <div className="flex justify-between mt-2">
                                            <span className="font-medium">
                                                Unit Price: {formatCurrency(price, clientCountry)}
                                            </span>
                                            <span className="font-medium">
                                                {formatCurrency(
                                                    product.subtotal ?? price * quantity,
                                                    clientCountry
                                                )}
                                            </span>
                                        </div>

                                        {Object.keys(product.stockData || {}).length > 0 && (
                                            <div className="mt-1 text-xs text-muted-foreground">
                                                {(() => {
                                                    const base = stockForCountry(product, clientCountry);
                                                    const used = inCartQty(
                                                        product.id,
                                                        product.variationId ?? null,
                                                        orderItems
                                                    );
                                                    const remaining = Math.max(0, base - used);
                                                    return (
                                                        <>
                                                            Stock in {clientCountry || "country"}: {remaining}
                                                            {remaining === 0 && product.allowBackorders
                                                                ? " (backorder allowed)"
                                                                : ""}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div className="flex flex-col sm:flex-row gap-4">
                    <div className="flex-1">
                        <Label>Select Product</Label>
                        <Select
                            value={selectedProduct}
                            onValueChange={(val) => {
                                const { productId, variationId } = parseToken(val);

                                const obj =
                                    [...products, ...prodResults].find(
                                        (row) =>
                                            row.id === productId &&
                                            (row.variationId ?? null) === (variationId ?? null)
                                    ) || null;

                                if (!obj) return;

                                const hasFiniteStock =
                                    Object.keys(obj.stockData || {}).length > 0;
                                const remaining = hasFiniteStock
                                    ? Math.max(
                                        0,
                                        stockForCountry(obj, clientCountry) - inCartQty(
                                            productId,
                                            variationId ?? null,
                                            orderItems
                                        )
                                    )
                                    : Infinity;

                                if (hasFiniteStock && remaining === 0 && !obj.allowBackorders) {
                                    toast.error(
                                        "This product is out of stock for the selected country."
                                    );
                                    return;
                                }
                                pickProduct(val, obj);
                            }}
                            disabled={productsLoading}
                        >
                            <SelectTrigger>
                                <SelectValue
                                    placeholder={productsLoading ? "Loading…" : "Select a product"}
                                />
                            </SelectTrigger>
                            <SelectContent className="w-[500px]">
                                {/* Search bar */}
                                <div className="p-3 border-b flex items-center gap-2">
                                    <Search className="h-4 w-4 text-muted-foreground" />
                                    <Input
                                        value={prodTerm}
                                        onChange={(e) => setProdTerm(e.target.value)}
                                        placeholder="Search products (min 3 chars)"
                                        className="h-8"
                                    />
                                </div>

                                <ScrollArea className="max-h-72">
                                    {/* Local grouped (shop) products */}
                                    {groupByCategory(
                                        filteredProducts.filter((p) => !p.isAffiliate)
                                    ).map(([label, items]) => (
                                        <SelectGroup key={label}>
                                            <SelectLabel>{label}</SelectLabel>
                                            {items.map((p) => {
                                                const price =
                                                    p.regularPrice[clientCountry] ?? p.price;
                                                const hasFiniteStock =
                                                    Object.keys(p.stockData || {}).length > 0;
                                                const remaining = hasFiniteStock
                                                    ? Math.max(
                                                        0,
                                                        stockForCountry(p, clientCountry) - inCartQty(
                                                            p.id,
                                                            p.variationId ?? null,
                                                            orderItems
                                                        )
                                                    )
                                                    : Infinity;
                                                const shouldDisable = hasFiniteStock
                                                    ? remaining === 0 && !p.allowBackorders
                                                    : false;

                                                return (
                                                    <SelectItem
                                                        key={tokenOf(p)}
                                                        value={tokenOf(p)}
                                                        disabled={shouldDisable}
                                                    >
                                                        <span className="block max-w-[420px] truncate">
                                                            {p.title} — ${price}
                                                            {hasFiniteStock && (
                                                                <span className="ml-2 text-xs text-muted-foreground">
                                                                    Stock: {remaining}
                                                                    {remaining === 0 && p.allowBackorders
                                                                        ? " (backorder)"
                                                                        : ""}
                                                                    {shouldDisable ? " (out of stock)" : ""}
                                                                </span>
                                                            )}
                                                        </span>
                                                    </SelectItem>
                                                );
                                            })}
                                            <SelectSeparator />
                                        </SelectGroup>
                                    ))}

                                    {/* Local affiliate products */}
                                    {filteredProducts.some((p) => p.isAffiliate) && (
                                        <SelectGroup>
                                            <SelectLabel>Affiliate</SelectLabel>
                                            {filteredProducts
                                                .filter((p) => p.isAffiliate)
                                                .map((p) => (
                                                    <SelectItem key={tokenOf(p)} value={tokenOf(p)}>
                                                        {p.title} — {p.price} pts
                                                    </SelectItem>
                                                ))}
                                            <SelectSeparator />
                                        </SelectGroup>
                                    )}

                                    {/* Remote results (not yet cached) */}
                                    {prodResults.length > 0 && (
                                        <>
                                            {groupByCategory(
                                                prodResults.filter(
                                                    (p) =>
                                                        !p.isAffiliate &&
                                                        !products.some((lp) => tokenOf(lp) === tokenOf(p))
                                                )
                                            ).map(([label, items]) => (
                                                <SelectGroup key={`remote-${label}`}>
                                                    <SelectLabel>{label} — search</SelectLabel>
                                                    {items.map((p) => {
                                                        const price =
                                                            p.regularPrice?.[clientCountry] ?? p.price;
                                                        const hasFiniteStock =
                                                            Object.keys(p.stockData || {}).length > 0;
                                                        const remaining = hasFiniteStock
                                                            ? Math.max(
                                                                0,
                                                                stockForCountry(p, clientCountry) - inCartQty(
                                                                    p.id,
                                                                    p.variationId ?? null,
                                                                    orderItems
                                                                )
                                                            )
                                                            : Infinity;
                                                        const shouldDisable = hasFiniteStock
                                                            ? remaining === 0 && !p.allowBackorders
                                                            : false;

                                                        return (
                                                            <SelectItem
                                                                key={tokenOf(p)}
                                                                value={tokenOf(p)}
                                                                disabled={shouldDisable}
                                                            >
                                                                <span className="block max-w-[420px] truncate">
                                                                    {p.title} — ${price}
                                                                    <span className="ml-2 text-xs text-muted-foreground">
                                                                        {hasFiniteStock ? (
                                                                            <>
                                                                                Stock: {remaining}
                                                                                {remaining === 0 &&
                                                                                    p.allowBackorders
                                                                                    ? " (backorder)"
                                                                                    : ""}
                                                                                {shouldDisable ? " (out of stock)" : ""}
                                                                            </>
                                                                        ) : (
                                                                            "remote"
                                                                        )}
                                                                    </span>
                                                                </span>
                                                            </SelectItem>
                                                        );
                                                    })}
                                                    <SelectSeparator />
                                                </SelectGroup>
                                            ))}

                                            {/* Remote affiliate results */}
                                            {prodResults.some(
                                                (p) =>
                                                    p.isAffiliate &&
                                                    !products.some((lp) => tokenOf(lp) === tokenOf(p))
                                            ) && (
                                                    <SelectGroup>
                                                        <SelectLabel>Affiliate — search</SelectLabel>
                                                        {prodResults
                                                            .filter(
                                                                (p) =>
                                                                    p.isAffiliate &&
                                                                    !products.some(
                                                                        (lp) => tokenOf(lp) === tokenOf(p)
                                                                    )
                                                            )
                                                            .map((p) => (
                                                                <SelectItem key={tokenOf(p)} value={tokenOf(p)}>
                                                                    {p.title} — {p.price} pts
                                                                    <span className="ml-1 text-xs text-muted-foreground">
                                                                        (remote)
                                                                    </span>
                                                                </SelectItem>
                                                            ))}
                                                    </SelectGroup>
                                                )}
                                        </>
                                    )}

                                    {prodSearching && (
                                        <div className="px-3 py-2 text-sm text-muted-foreground">
                                            Searching…
                                        </div>
                                    )}
                                    {!prodSearching && prodTerm && prodResults.length === 0 && (
                                        <div className="px-3 py-2 text-sm text-muted-foreground">
                                            No matches
                                        </div>
                                    )}
                                </ScrollArea>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="w-24">
                        <Label>Quantity</Label>
                        <Input
                            type="number"
                            min={1}
                            inputMode="numeric"
                            pattern="[0-9]*"
                            value={quantityText}
                            onChange={(e) => {
                                const v = e.target.value.replace(/[^0-9]/g, "");
                                setQuantityText(v);
                            }}
                            onBlur={() => setQuantityText(String(parseQty(quantityText)))}
                        />
                    </div>

                    <div className="flex items-end">
                        <Button onClick={addProduct} disabled={!selectedProduct}>
                            <Plus className="h-4 w-4 mr-2" /> Add Product
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
