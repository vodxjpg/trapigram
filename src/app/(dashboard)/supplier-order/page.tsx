// app/(dashboard)/purchase-orders/PurchaseOrderSupply.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import {
    Card,
    CardContent,
    CardFooter,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import {
    Drawer,
    DrawerClose,
    DrawerContent,
    DrawerDescription,
    DrawerFooter,
    DrawerHeader,
    DrawerTitle,
} from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Package, Plus, X, Trash2, Search, Edit } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar as CalendarIcon } from "lucide-react";
import { format } from "date-fns";


/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type Supplier = {
    id: string;
    code: string;
    name: string;
    email: string;
    phone?: string | null;
};

type SuppliersResponse = { suppliers: Supplier[] } | Supplier[];

type Product = {
    id: string;
    title: string;
    sku: string;
    description: string;
    regularPrice: Record<string, number>;
    price: number;
    image: string;
    stockData: Record<string, Record<string, number>>;
    allowBackorders?: boolean;
    isAffiliate?: boolean;
    categories?: string[];
    subtotal?: number;
};

type OrderItem = { product: Product; quantity: number };

type Warehouse = { id: string; name: string; countries: string[] };

// ─────────────────────────────────────────────────────────────────────────────
// helpers to safely read the allocations array from any common response shape
// ─────────────────────────────────────────────────────────────────────────────
function asArray<T = any>(v: any): T[] {
    return Array.isArray(v) ? v : [];
}

function normalizeAllocationsPayload(payload: any): Array<{
    warehouseId: string;
    country: string;
    quantity: number;
    unitCost: number;
}> {
    const arr =
        asArray(payload) ||
        asArray(payload?.result) ||
        asArray(payload?.rows) ||
        asArray(payload?.data) ||
        asArray(payload?.allocations);

    // Coerce shapes + numbers
    return arr.map((r: any) => ({
        warehouseId: r.warehouseId ?? r.warehouse?.id ?? r.wid ?? "",
        country: r.country ?? r.countryCode ?? r.ct ?? "",
        quantity: Number(r.quantity ?? r.qty ?? 0) || 0,
        unitCost: Number(r.unitCost ?? r.cost ?? 0) || 0,
    }));
}


/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const DEBOUNCE_MS = 400;

function firstPointPrice(pp: any): number {
    if (!pp) return 0;
    const firstLvl = (Object.values(pp)[0] as any) ?? {};
    const firstCtMap = (Object.values(firstLvl)[0] as any) ?? {};
    return firstCtMap.sale ?? firstCtMap.regular ?? 0;
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function PurchaseOrderSupply() {
    /* ───── suppliers + cart ───── */
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState("");
    const [cartId, setCartId] = useState("");
    const [orderGenerated, setOrderGenerated] = useState(false);
    const [notes, setNotes] = useState("");
    const [expectedAt, setExpectedAt] = useState<Date | undefined>(undefined);

    /* ───── products + search (same behavior as your order view) ───── */
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [selectedProduct, setSelectedProduct] = useState("");
    const [prodTerm, setProdTerm] = useState("");
    const [prodSearching, setProdSearching] = useState(false);
    const [prodResults, setProdResults] = useState<Product[]>([]);
    const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    const groupByCategory = (arr: Product[]) => {
        const buckets: Record<string, Product[]> = {};
        for (const p of arr) {
            if (p.isAffiliate) continue;
            const firstCat = p.categories?.[0];
            const label = firstCat
                ? categoryMap[firstCat] || firstCat
                : "Uncategorized";
            if (!buckets[label]) buckets[label] = [];
            buckets[label].push(p);
        }
        return Object.entries(buckets)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
                ([label, items]) =>
                    [label, items.sort((x, y) => x.title.localeCompare(y.title))] as const
            );
    };

    /* ───── displayed lines (no qty input; qty text at 0) ───── */
    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

    /* ───── drawer state (allocation UI) ───── */
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [adding, setAdding] = useState(false);

    // editable map: warehouseId -> country -> { qty, cost }
    const [editable, setEditable] = useState<
        Record<string, Record<string, { qty: number; cost: number }>>
    >({});

    /* ------------------------------------------------------------------ */
    /* Load suppliers                                                     */
    /* ------------------------------------------------------------------ */
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/suppliers", { cache: "no-store" });
                if (!res.ok) throw new Error("Failed to load suppliers");
                const data: SuppliersResponse = await res.json();
                const list = Array.isArray(data) ? data : data.suppliers;
                setSuppliers(Array.isArray(list) ? list : []);
            } catch (err: any) {
                toast.error(err?.message || "Error loading suppliers");
            }
        })();
    }, []);

    /* ------------------------------------------------------------------ */
    /* Load categories (for grouping in the product select)                */
    /* ------------------------------------------------------------------ */
    useEffect(() => {
        (async () => {
            try {
                const res = await fetch("/api/product-categories?all=1");
                if (res.ok) {
                    const data = await res.json();
                    const rows: Array<{ id: string; name: string }> =
                        data.categories ?? data.items ?? [];
                    setCategoryMap(Object.fromEntries(rows.map((c) => [c.id, c.name])));
                }
            } catch {
                // fall back to IDs as labels
            }
        })();
    }, []);

    /* ------------------------------------------------------------------ */
    /* Load products (shop + affiliate)                                    */
    /* ------------------------------------------------------------------ */
    useEffect(() => {
        (async () => {
            setProductsLoading(true);
            try {
                const [normRes, affRes] = await Promise.all([
                    fetch("/api/products?page=1&pageSize=1000"),
                    fetch("/api/affiliate/products?limit=1000"),
                ]);
                if (!normRes.ok || !affRes.ok)
                    throw new Error("Failed to fetch products");

                const { products: norm } = await normRes.json();
                const { products: aff } = await affRes.json();

                const all: Product[] = [
                    ...norm.map((p: any) => ({
                        id: p.id,
                        title: p.title,
                        allowBackorders: !!p.allowBackorders,
                        sku: p.sku,
                        description: p.description,
                        image: p.image,
                        regularPrice: p.regularPrice,
                        price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
                        stockData: p.stockData,
                        isAffiliate: false,
                        subtotal: 0,
                        categories: p.categories ?? [],
                    })),
                    ...aff.map((a: any) => {
                        const firstPts = firstPointPrice(a.pointsPrice);
                        const regularPrice: Record<string, number> = { pts: firstPts };
                        return {
                            id: a.id,
                            title: a.title,
                            sku: a.sku,
                            description: a.description,
                            image: a.image,
                            regularPrice,
                            price: firstPts,
                            stockData: a.stock ?? {},
                            isAffiliate: true,
                            subtotal: 0,
                            categories: [],
                        };
                    }),
                ];

                setProducts(all);
            } catch (e: any) {
                toast.error(e?.message || "Failed loading products");
            } finally {
                setProductsLoading(false);
            }
        })();
    }, []);

    const handleEditClick = async (productId: string) => {
        if (!orderGenerated || !cartId) {
            toast.error("Generate the suppliers cart first");
            return;
        }
        try {
            setSelectedProduct(productId);
            setEditingProductId(productId);

            // 1) Warehouses (layout only)
            const wRes = await fetch("/api/warehouses", {
                headers: {
                    "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
                },
            });
            if (!wRes.ok) throw new Error("Failed to load warehouses");
            const wData = await wRes.json();
            const whs: Warehouse[] = wData?.warehouses ?? [];
            setWarehouses(whs);

            // 2) Build zeros for every cell so UI always shows all inputs
            const zero: Record<string, Record<string, { qty: number; cost: number }>> = {};
            for (const w of whs) {
                zero[w.id] = {};
                for (const c of w.countries) zero[w.id][c] = { qty: 0, cost: 0 };
            }

            // 3) Fetch existing allocations for this product
            const aRes = await fetch(`/api/suppliersCart/product/${productId}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
            });
            if (!aRes.ok) throw new Error("Failed to load product allocations");

            const { result } = await aRes.json().catch(() => ({}));
            const rows = normalizeAllocationsPayload(result); // ← always an array

            // 4) Prefill zeros with existing values
            for (const r of rows) {
                if (!r.warehouseId || !r.country) continue;
                if (!zero[r.warehouseId]) zero[r.warehouseId] = {};
                zero[r.warehouseId][r.country] = {
                    qty: r.quantity,
                    cost: r.quantity === 0 ? 0 : r.unitCost,
                };
            }

            setEditable(zero);
            setDrawerOpen(true);
        } catch (err: any) {
            console.error("Edit drawer error:", err);
            toast.error(err?.message || "Could not open edit drawer");
            setEditingProductId(null);
        }
    };



    /* ------------------------------------------------------------------ */
    /* Product search (remote), like your order view                       */
    /* ------------------------------------------------------------------ */
    const filteredProducts = useMemo(() => {
        const q = prodTerm.trim();
        if (q.length < 3) return products;
        const qq = q.toLowerCase();
        return products.filter(
            (p) =>
                p.title.toLowerCase().includes(qq) || p.sku.toLowerCase().includes(qq)
        );
    }, [products, prodTerm]);

    const totalSelectedQty = useMemo(
        () => orderItems.reduce((sum, it) => sum + Number(it.quantity ?? 0), 0),
        [orderItems]
    );

    const completing = false; // optional: wire a state if you want a spinner

    const completeOrder = async () => {
        if (!orderGenerated || !cartId) {
            toast.error("Generate a cart first");
            return;
        }
        if (!selectedSupplierId) {
            toast.error("Select a supplier");
            return;
        }
        if (!expectedAt) {
            toast.error("Choose an expected date");
            return;
        }

        try {
            const payload = {
                supplierId: selectedSupplierId,
                supplierCartId: cartId,
                note: notes || "",
                expectedAt: expectedAt.toISOString(),
            };

            const res = await fetch("/api/suppliersOrder", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            if (!res.ok) {
                const msg = await res.text().catch(() => "Failed to complete order");
                throw new Error(msg);
            }

            toast.success("Purchase order created");
        } catch (err: any) {
            toast.error(err?.message || "Could not complete order");
        }
    };



    useEffect(() => {
        const q = prodTerm.trim();
        if (q.length < 3) {
            setProdResults([]);
            setProdSearching(false);
            return;
        }
        const t = setTimeout(async () => {
            try {
                setProdSearching(true);
                const [shop, aff] = await Promise.all([
                    fetch(
                        `/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=20`
                    )
                        .then((r) => r.json())
                        .then((d) => d.products as any[]),
                    fetch(
                        `/api/affiliate/products?search=${encodeURIComponent(q)}&limit=20`
                    )
                        .then((r) => r.json())
                        .then((d) => d.products as any[]),
                ]);

                const mapShop = (p: any): Product => ({
                    ...p,
                    allowBackorders: !!p.allowBackorders,
                    price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
                    stockData: p.stockData,
                    isAffiliate: false,
                    categories: p.categories ?? [],
                });
                const mapAff = (a: any): Product => ({
                    ...a,
                    price: Object.values(a.pointsPrice)[0] ?? 0,
                    stockData: a.stock,
                    isAffiliate: true,
                    categories: [],
                });

                setProdResults([...shop.map(mapShop), ...aff.map(mapAff)]);
            } catch {
                setProdResults([]);
            } finally {
                setProdSearching(false);
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(t);
    }, [prodTerm]);

    /* ------------------------------------------------------------------ */
    /* Generate suppliers cart                                             */
    /* ------------------------------------------------------------------ */
    const generateOrder = async () => {
        if (!selectedSupplierId) {
            toast.error("Select a supplier first");
            return;
        }
        try {
            const resC = await fetch("/api/suppliersCart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ supplierId: selectedSupplierId }),
            });
            if (!resC.ok) {
                const msg = await resC
                    .text()
                    .catch(() => "Failed to create suppliers cart");
                throw new Error(msg);
            }
            const dataC = await resC.json();
            const { newCart } = dataC;
            setCartId(newCart.id);

            // refresh lines from server
            await reloadCartLines(newCart.id);

            toast.success("Suppliers cart created");
            setOrderGenerated(true);

            // optional: load existing lines (if any)
            const resP = await fetch(`/api/suppliersCart/${newCart.id}`, {
                headers: { "Content-Type": "application/json" },
            });
            const dataP = await resP.json().catch(() => ({}));
            const resultCartProducts = dataP?.resultCartProducts ?? [];

            if (Array.isArray(resultCartProducts)) {
                setOrderItems(
                    resultCartProducts.map((r: any) => ({
                        product: {
                            id: r.id,
                            title: r.title,
                            sku: r.sku,
                            description: r.description,
                            image: r.image,
                            price: r.unitPrice ?? 0,
                            regularPrice: {},
                            stockData: {},
                            subtotal: r.subtotal ?? 0,
                        },
                        quantity: r.quantity ?? 0,
                    }))
                );
            }

            toast.success("Suppliers cart created");
            setOrderGenerated(true);
        } catch (err: any) {
            toast.error(err?.message || "Could not create suppliers cart");
        }
    };

    // Reload current cart lines from /api/suppliersCart/[id] and update UI
    const reloadCartLines = async (id: string) => {
        try {
            const res = await fetch(`/api/suppliersCart/${id}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
            });
            if (!res.ok) throw new Error(`Failed to reload cart (${res.status})`);
            const data = await res.json().catch(() => ({}));
            const rows = data?.resultCartProducts ?? [];

            const mapped: OrderItem[] = rows.map((r: any) => ({
                product: {
                    id: r.productId ?? r.id,
                    title: r.title,
                    sku: r.sku,
                    description: r.description,
                    image: r.image,
                    price: r.unitPrice ?? r.unitCost ?? 0,
                    regularPrice: {},
                    stockData: {},
                    subtotal:
                        r.subtotal ??
                        Number(r.unitPrice ?? r.unitCost ?? 0) * Number(r.quantity ?? 0),
                },
                quantity: Number(r.quantity ?? 0),
            }));

            setOrderItems(mapped);
        } catch (e: any) {
            toast.error(e?.message || "Could not refresh cart items");
        }
    };

    // Ensure warehouses are loaded (used by both Add + Edit flows)
    const ensureWarehouses = async (): Promise<Warehouse[]> => {
        if (warehouses.length) return warehouses;
        const res = await fetch("/api/warehouses", {
            headers: {
                "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
            },
        });
        if (!res.ok) throw new Error("Failed to load warehouses");
        const data = await res.json();
        const whs: Warehouse[] = data?.warehouses ?? [];
        setWarehouses(whs);
        return whs;
    };

    // Build zeroed grid then overlay allocations from server
    type AllocationRow = {
        warehouseId: string;
        country: string;
        quantity: number;
        cost: number;
    };

    const overlayAllocations = (
        whs: Warehouse[],
        allocs: AllocationRow[]
    ) => {
        const base: Record<string, Record<string, { qty: number; cost: number }>> = {};
        for (const w of whs) {
            base[w.id] = {};
            for (const c of w.countries) base[w.id][c] = { qty: 0, cost: 0 };
        }
        for (const a of allocs) {
            if (!base[a.warehouseId]) base[a.warehouseId] = {};
            if (!base[a.warehouseId][a.country]) base[a.warehouseId][a.country] = { qty: 0, cost: 0 };
            base[a.warehouseId][a.country] = {
                qty: Number(a.quantity || 0),
                cost: Number(a.cost || 0),
            };
        }
        setEditable(base);
    };

    const openAddDrawer = async () => {
        if (!orderGenerated) return toast.error("Create the suppliers cart first");
        if (!selectedProduct) return toast.error("Select a product first");
        try {
            const whs = await ensureWarehouses();
            // zeroed grid
            const zero: Record<string, Record<string, { qty: number; cost: number }>> = {};
            for (const w of whs) {
                zero[w.id] = {};
                for (const c of w.countries) zero[w.id][c] = { qty: 0, cost: 0 };
            }
            setEditable(zero);
            setDrawerOpen(true);
        } catch (err: any) {
            toast.error(err?.message || "Could not load warehouses");
        }
    };

    const openEditDrawer = async (productId: string) => {
        if (!orderGenerated) return toast.error("Create the suppliers cart first");
        try {
            const whs = await ensureWarehouses();
            setSelectedProduct(productId); // so Save uses this id

            // GET allocations for this product
            const res = await fetch(`/api/suppliersCart/product/${productId}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
            });
            if (!res.ok) {
                const msg = await res.text().catch(() => "Failed to load product allocations");
                throw new Error(msg);
            }

            // Expect an array of { warehouseId, country, quantity, cost }
            const raw = await res.json();
            const arr: AllocationRow[] = Array.isArray(raw)
                ? raw
                : Array.isArray(raw?.result)
                    ? raw.result
                    : [];

            overlayAllocations(
                whs,
                arr.map((r: any) => ({
                    warehouseId: r.warehouseId,
                    country: r.country,
                    quantity: Number(r.quantity ?? 0),
                    cost: Number(r.cost ?? r.unitCost ?? 0),
                }))
            );
            setDrawerOpen(true);
        } catch (err: any) {
            toast.error(err?.message || "Could not load allocations");
        }
    };


    /* ------------------------------------------------------------------ */
    /* Drawer: fetch warehouses (for layout only) & init editable zeros    */
    /* ------------------------------------------------------------------ */
    const initEditableZeros = (whs: Warehouse[]) => {
        const next: Record<
            string,
            Record<string, { qty: number; cost: number }>
        > = {};
        for (const w of whs) {
            next[w.id] = {};
            for (const c of w.countries) {
                next[w.id][c] = { qty: 0, cost: 0 };
            }
        }
        setEditable(next);
    };

    const openDrawer = async () => {
        if (!orderGenerated) {
            toast.error("Create the suppliers cart first");
            return;
        }
        if (!selectedProduct) {
            toast.error("Select a product first");
            return;
        }
        try {
            // fetch warehouses only for structure; do NOT pre-fill quantities
            const res = await fetch("/api/warehouses", {
                headers: {
                    "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
                },
            });
            if (!res.ok) throw new Error("Failed to load warehouses");
            const data = await res.json();
            const whs: Warehouse[] = data?.warehouses ?? [];
            setWarehouses(whs);
            initEditableZeros(whs);
            setDrawerOpen(true);
        } catch (err: any) {
            toast.error(err?.message || "Could not load warehouses");
        }
    };

    /* ------------------------------------------------------------------ */
    /* Drawer handlers: qty & cost changes                                 */
    /* ------------------------------------------------------------------ */
    const handleQtyChange = (wid: string, country: string, qty: number) => {
        const safeQty = Math.max(0, Number.isFinite(qty) ? qty : 0);
        setEditable((prev) => {
            const prevCell = prev[wid]?.[country] || { qty: 0, cost: 0 };
            return {
                ...prev,
                [wid]: {
                    ...(prev[wid] || {}),
                    [country]: {
                        qty: safeQty,
                        cost: safeQty === 0 ? 0 : prevCell.cost,
                    },
                },
            };
        });
    };



    const handleCostChange = (wid: string, country: string, cost: number) => {
        setEditable((prev) => ({
            ...prev,
            [wid]: {
                ...(prev[wid] || {}),
                [country]: {
                    ...(prev[wid]?.[country] || { qty: 0, cost: 0 }),
                    cost: Math.max(0, Number.isFinite(cost) ? cost : 0),
                },
            },
        }));
    };

    const clearWarehouse = (wid: string) => {
        setEditable((prev) => {
            const next = { ...prev };
            const block = { ...(next[wid] || {}) };
            warehouses
                .find((w) => w.id === wid)
                ?.countries.forEach((c) => (block[c] = { qty: 0, cost: 0 }));
            next[wid] = block;
            return next;
        });
    };

    const totalQty = useMemo(
        () =>
            Object.values(editable).reduce(
                (sum, byCt) =>
                    sum +
                    Object.values(byCt).reduce((s, v) => s + (Number(v?.qty) || 0), 0),
                0
            ),
        [editable]
    );

    /* ------------------------------------------------------------------ */
    /* Save allocations -> POST suppliersCart/:id/add-product              */
    /* ------------------------------------------------------------------ */
    const saveAllocations = async () => {
        if (!cartId) {
            toast.error("Create a suppliers cart first");
            return;
        }
        const allocations = Object.entries(editable).flatMap(([warehouseId, byCt]) =>
            Object.entries(byCt).map(([country, v]) => ({
                warehouseId,
                country,
                quantity: Number(v?.qty || 0),
                unitCost: Number(v?.cost || 0),
            }))
        );

        setAdding(true);
        try {
            const isEditing = !!editingProductId;

            const url = isEditing
                ? `/api/suppliersCart/product/${editingProductId}`
                : `/api/suppliersCart/${cartId}/add-product`;

            const method = isEditing ? "PATCH" : "POST";

            // ⬇️ Include supplierCartId when PATCHing (edit mode)
            const body = isEditing
                ? {
                    supplierCartId: cartId,
                    productId: editingProductId, // optional, but harmless if your API accepts it
                    allocations,
                }
                : {
                    productId: selectedProduct,
                    allocations,
                };

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });

            if (!res.ok) throw new Error(await res.text());

            await reloadCartLines(cartId);
            setDrawerOpen(false);
            setEditingProductId(null);
            toast.success(isEditing ? "Allocations updated" : "Product allocations saved");
        } catch (e: any) {
            toast.error(e?.message || "Could not save allocations");
        } finally {
            setAdding(false);
        }
    };

    /* ------------------------------------------------------------------ */
    /* Render                                                              */
    /* ------------------------------------------------------------------ */
    return (
        <div className="container mx-auto py-6">
            <h1 className="text-3xl font-bold mb-6">Purchase Order (Supply)</h1>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* LEFT – main flow */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Supplier Selection */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Supplier</CardTitle>
                        </CardHeader>
                        <CardContent className="flex flex-col sm:flex-row gap-4">
                            <div className="flex-1">
                                <Label>Select Supplier</Label>
                                <Select
                                    value={selectedSupplierId}
                                    onValueChange={setSelectedSupplierId}
                                    disabled={orderGenerated}
                                >
                                    <SelectTrigger>
                                        <SelectValue placeholder="Choose a supplier" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {suppliers.map((s) => (
                                            <SelectItem key={s.id} value={s.id}>
                                                {s.name} — {s.email}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-end">
                                <Button
                                    onClick={generateOrder}
                                    disabled={!selectedSupplierId || orderGenerated}
                                >
                                    Generate Order
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Product Selection */}
                    <Card
                        className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}
                    >
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Package className="h-5 w-5" /> Product Selection
                            </CardTitle>
                        </CardHeader>

                        <CardContent className="space-y-4">
                            {/* Current items */}
                            {orderItems.length > 0 && (
                                <div className="mb-4">
                                    <div className="border rounded-lg overflow-hidden">
                                        <div className="bg-muted/50 px-4 py-2 border-b">
                                            <h4 className="font-medium text-sm">
                                                Added Products ({orderItems.length})
                                            </h4>
                                        </div>
                                        <div className="divide-y">
                                            {orderItems.map(({ product, quantity }, idx) => (
                                                <div
                                                    key={`${product.id}-${idx}`}
                                                    className="flex items-center gap-3 p-3 hover:bg-muted/30"
                                                >
                                                    <Image
                                                        src={product.image || "/placeholder.svg"}
                                                        alt={product.title}
                                                        width={40}
                                                        height={40}
                                                        className="rounded object-cover flex-shrink-0"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <h5 className="font-medium text-sm truncate">
                                                            {product.title}
                                                        </h5>
                                                        <p className="text-xs text-muted-foreground">
                                                            SKU: {product.sku}
                                                        </p>
                                                    </div>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        title="Edit allocations"
                                                        className="flex items-center space-x-1"
                                                        onClick={() => handleEditClick(product.id)}
                                                    >
                                                        <span>{quantity ?? 0}</span>
                                                        <Edit className="h-4 w-4 text-gray-500" />
                                                    </Button>

                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        title="Click to update stock"
                                                        className="flex items-center space-x-1"
                                                        onClick={() => {
                                                            // TODO: Add remove functionality if needed
                                                            toast.info(
                                                                "Remove functionality not implemented yet"
                                                            );
                                                        }}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Picker + Add button (opens drawer) */}
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="flex-1">
                                    <Label>Select Product</Label>
                                    <Select
                                        value={selectedProduct}
                                        onValueChange={(val) => {
                                            setSelectedProduct(val);
                                            setProdTerm(""); // reset inline search
                                            setProdResults([]);
                                        }}
                                        disabled={productsLoading}
                                    >
                                        <SelectTrigger>
                                            <SelectValue
                                                placeholder={
                                                    productsLoading ? "Loading…" : "Select a product"
                                                }
                                            />
                                        </SelectTrigger>

                                        <SelectContent className="w-[520px]">
                                            {/* Inline search box */}
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
                                                {/* Local (grouped) shop products */}
                                                {groupByCategory(
                                                    filteredProducts.filter((p) => !p.isAffiliate)
                                                ).map(([label, items]) => (
                                                    <SelectGroup key={label}>
                                                        <SelectLabel>{label}</SelectLabel>
                                                        {items.map((p) => (
                                                            <SelectItem key={p.id} value={p.id}>
                                                                {p.title} — ${p.price}
                                                            </SelectItem>
                                                        ))}
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
                                                                <SelectItem key={p.id} value={p.id}>
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
                                                                    !products.some((lp) => lp.id === p.id)
                                                            )
                                                        ).map(([label, items]) => (
                                                            <SelectGroup key={`remote-${label}`}>
                                                                <SelectLabel>{label} — search</SelectLabel>
                                                                {items.map((p) => (
                                                                    <SelectItem key={p.id} value={p.id}>
                                                                        {p.title} — ${p.price}
                                                                        <span className="ml-1 text-xs text-muted-foreground">
                                                                            (remote)
                                                                        </span>
                                                                    </SelectItem>
                                                                ))}
                                                                <SelectSeparator />
                                                            </SelectGroup>
                                                        ))}

                                                        {/* Remote affiliate results */}
                                                        {prodResults.some(
                                                            (p) =>
                                                                p.isAffiliate &&
                                                                !products.some((lp) => lp.id === p.id)
                                                        ) && (
                                                                <SelectGroup>
                                                                    <SelectLabel>Affiliate — search</SelectLabel>
                                                                    {prodResults
                                                                        .filter(
                                                                            (p) =>
                                                                                p.isAffiliate &&
                                                                                !products.some((lp) => lp.id === p.id)
                                                                        )
                                                                        .map((p) => (
                                                                            <SelectItem key={p.id} value={p.id}>
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
                                                {!prodSearching &&
                                                    prodTerm &&
                                                    prodResults.length === 0 && (
                                                        <div className="px-3 py-2 text-sm text-muted-foreground">
                                                            No matches
                                                        </div>
                                                    )}
                                            </ScrollArea>
                                        </SelectContent>
                                    </Select>
                                </div>

                                {/* Add Product → opens drawer */}
                                <div className="flex items-end">
                                    <Button
                                        onClick={openAddDrawer}
                                        disabled={!selectedProduct || !orderGenerated}
                                    >
                                        <Plus className="h-4 w-4 mr-2" /> Add Product
                                    </Button>

                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Notes card for optional order notes */}
                    <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
                        <CardHeader>
                            <CardTitle>Notes (optional)</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                placeholder="Add any additional notes or special instructions for this purchase order..."
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="min-h-[100px] resize-none"
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT – simple summary */}
                <div className="lg:col-span-1">
                    <Card className="sticky top-6">
                        <CardHeader>
                            <CardTitle>Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <div className="flex justify-between">
                                <span>Supplier:</span>
                                <span className="font-medium">
                                    {suppliers.find((s) => s.id === selectedSupplierId)?.name || "—"}
                                </span>
                            </div>
                            <div className="flex justify-between">
                                <span>Items:</span>
                                <span className="font-medium">{orderItems.length}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Qty Total:</span>
                                <span className="font-bold">{totalSelectedQty}</span>
                            </div>
                        </CardContent>

                        <CardFooter className="flex flex-col gap-3">
                            <div className="w-full">
                                <Label className="mb-1 block">Expected at</Label>

                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            className="w-full justify-start text-left font-normal"
                                            disabled={!selectedSupplierId}
                                        >
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {expectedAt ? format(expectedAt, "PPP") : "Pick a date"}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={expectedAt}
                                            onSelect={setExpectedAt}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                {!selectedSupplierId && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Select a supplier to choose a date.
                                    </p>
                                )}
                            </div>

                            <Button
                                onClick={completeOrder}
                                disabled={!orderGenerated || orderItems.length === 0 || !expectedAt}
                                className="w-full"
                            >
                                Complete Order
                            </Button>

                            <p className="text-xs text-muted-foreground text-center">
                                Generate a cart, add products in the drawer, pick an expected date, then complete the order.
                            </p>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            {/* ──────────────────────────────────────────────────────────────── */}
            {/* Drawer (clone of stock-management UI, with Qty + Unit Cost)     */}
            {/* ──────────────────────────────────────────────────────────────── */}
            <Drawer
                open={drawerOpen}
                onOpenChange={(open) => {
                    setDrawerOpen(open);
                    if (!open) setEditingProductId(null);
                }}
            >

                <DrawerContent
                    className="
            fixed inset-x-0 bottom-0 top-auto w-full
            rounded-t-2xl border-t bg-background p-0
            data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-10
            data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-10
            h-[85vh] sm:h-[85vh]
          "
                >
                    <DrawerHeader className="px-6 py-4">
                        <div className="flex items-center justify-between">
                            <DrawerTitle className="text-base sm:text-lg">
                                Allocate —{" "}
                                <span className="font-normal">
                                    {selectedProduct
                                        ? [...products, ...prodResults].find(
                                            (p) => p.id === selectedProduct
                                        )?.title
                                        : ""}
                                </span>
                            </DrawerTitle>
                            <DrawerClose asChild>
                                <Button variant="ghost" size="icon" aria-label="Close">
                                    <X className="h-5 w-5" />
                                </Button>
                            </DrawerClose>
                        </div>
                        <DrawerDescription className="mt-1">
                            Set quantities and unit costs per warehouse & country. Total Qty:{" "}
                            <span className="font-medium">{totalQty}</span>
                        </DrawerDescription>
                    </DrawerHeader>

                    <Separator />

                    {/* Scrollable drawer body */}
                    <div className="overflow-y-auto px-6 py-4 h-[calc(85vh-9rem)] sm:h-[calc(85vh-9rem)]">
                        {warehouses.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                No warehouses found.
                            </p>
                        ) : (
                            <div className="space-y-6">
                                {warehouses.map((w) => (
                                    <div key={w.id} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-medium">{w.name}</h3>
                                            <div className="flex gap-2">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() => clearWarehouse(w.id)}
                                                >
                                                    Clear
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {w.countries.map((c) => {
                                                const cell = editable[w.id]?.[c] || { qty: 0, cost: 0 };
                                                const qtyIsZero = (cell.qty ?? 0) === 0;

                                                return (
                                                    <div key={`${w.id}-${c}`} className="rounded-md border p-3 flex flex-col gap-2">
                                                        <span className="text-sm">{c}</span>
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div>
                                                                <Label className="text-xs">Qty</Label>
                                                                <Input
                                                                    inputMode="numeric"
                                                                    type="number"
                                                                    min={0}
                                                                    className="mt-1 w-full"
                                                                    value={cell.qty}
                                                                    onChange={(e) =>
                                                                        handleQtyChange(
                                                                            w.id,
                                                                            c,
                                                                            parseInt(e.target.value.replace(/\D/g, "") || "0", 10)
                                                                        )
                                                                    }
                                                                />
                                                            </div>
                                                            <div>
                                                                <Label className="text-xs">Unit Cost</Label>
                                                                <Input
                                                                    inputMode="decimal"
                                                                    type="number"
                                                                    min={0}
                                                                    step="0.01"
                                                                    className="mt-1 w-full"
                                                                    value={cell.cost}
                                                                    onChange={(e) =>
                                                                        handleCostChange(w.id, c, parseFloat(e.target.value) || 0)
                                                                    }
                                                                    disabled={qtyIsZero}
                                                                    placeholder={qtyIsZero ? "Set Qty first" : undefined}
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                );
                                            })}

                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <Separator />

                    <DrawerFooter className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2">
                            <DrawerClose asChild>
                                <Button variant="outline">Cancel</Button>
                            </DrawerClose>
                            <Button
                                onClick={saveAllocations}
                                disabled={adding || !selectedProduct || !cartId}
                            >
                                {adding ? "Saving…" : "Save"}
                            </Button>
                        </div>
                    </DrawerFooter>
                </DrawerContent>
            </Drawer>
        </div>
    );
}
