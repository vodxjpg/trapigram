// app/(dashboard)/purchase-orders/PurchaseOrderSupply.tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
    Package,
    Plus,
    X,
    Trash2,
    Search,
    Edit,
    Calendar as CalendarIcon,
    ArrowLeft
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
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

type OrderStatus = "draft" | "pending" | "completed";

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const DEBOUNCE_MS = 400;

function firstPointPrice(pp: any): number {
    if (!pp) return 0;
    const firstLvl = (Object.values(pp)[0] as any) ?? {};
    const firstCtMap = (Object.values(firstLvl)[0] as any) ?? {};
    return firstCtMap.sale ?? firstCtMap.regular ?? 0;
}

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

    return arr.map((r: any) => ({
        warehouseId: r.warehouseId ?? r.warehouse?.id ?? r.wid ?? "",
        country: r.country ?? r.countryCode ?? r.ct ?? "",
        quantity: Number(r.quantity ?? r.qty ?? 0) || 0,
        unitCost: Number(r.unitCost ?? r.cost ?? 0) || 0,
    }));
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

export default function PurchaseOrderSupply({
    orderId: initialOrderId,
}: { orderId?: string }) {
    const router = useRouter();
    /* Suppliers + cart */
    const [suppliers, setSuppliers] = useState<Supplier[]>([]);
    const [selectedSupplierId, setSelectedSupplierId] = useState("");
    const [cartId, setCartId] = useState("");
    const [orderGenerated, setOrderGenerated] = useState(false);
    const [notes, setNotes] = useState("");
    const [expectedAt, setExpectedAt] = useState<Date | undefined>(undefined);

    /* Products + search */
    const [products, setProducts] = useState<Product[]>([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [selectedProduct, setSelectedProduct] = useState("");
    const [prodTerm, setProdTerm] = useState("");
    const [prodSearching, setProdSearching] = useState(false);
    const [prodResults, setProdResults] = useState<Product[]>([]);
    const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
    const [editingProductId, setEditingProductId] = useState<string | null>(null);

    // Track added products to disable them in the Select
    const [addedProductIds, setAddedProductIds] = useState<Set<string>>(
        () => new Set()
    );

    // Single source of truth for order id/status
    const [currentOrderId, setCurrentOrderId] = useState<string | null>(initialOrderId ?? null);
    const [orderStatus, setOrderStatus] = useState<OrderStatus | null>(null);
    const isLocked = orderStatus === "completed";
    const isPending = orderStatus === "pending" || orderStatus === "completed"

    /* When editing, hydrate from API */
    useEffect(() => {
        if (!currentOrderId) return;
        const ctrl = new AbortController();
        (async () => {
            try {
                const res = await fetch(`/api/suppliersOrder/${currentOrderId}`, { signal: ctrl.signal });
                if (!res.ok) throw new Error("Failed to load order");
                const { order } = await res.json();

                setSelectedSupplierId(order.supplierId);
                setCartId(order.supplierCartId);
                setNotes(order.note ?? "");
                setExpectedAt(order.expectedAt ? new Date(order.expectedAt) : undefined);
                setOrderStatus(order.status as OrderStatus);
                setOrderGenerated(true);

                await reloadCartLines(order.supplierCartId);
            } catch (e: any) {
                if (e?.name !== "AbortError") toast.error(e?.message || "Could not load order");
            }
        })();
        return () => ctrl.abort();
    }, [currentOrderId]);

    const groupByCategory = (arr: Product[]) => {
        const buckets: Record<string, Product[]> = {};
        for (const p of arr) {
            if (p.isAffiliate) continue;
            const firstCat = p.categories?.[0];
            const label = firstCat ? categoryMap[firstCat] || firstCat : "Uncategorized";
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

    /* Displayed lines */
    const [orderItems, setOrderItems] = useState<OrderItem[]>([]);

    /* Drawer state (allocation UI) */
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
    const [adding, setAdding] = useState(false);

    const [editable, setEditable] = useState<
        Record<string, Record<string, { qty: number; cost: number }>>
    >({});

    /* Load suppliers */
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

    /* Load categories (for grouping) */
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
                // noop
            }
        })();
    }, []);

    /* Load products (shop + affiliate) */
    useEffect(() => {
        (async () => {
            setProductsLoading(true);
            try {
                const [normRes, affRes] = await Promise.all([
                    fetch("/api/products?page=1&pageSize=1000"),
                    fetch("/api/affiliate/products?limit=1000"),
                ]);
                if (!normRes.ok || !affRes.ok) throw new Error("Failed to fetch products");

                const { products: norm } = await normRes.json();

                const all: Product[] = [
                    ...norm.map((p: any) => ({
                        id: p.id,
                        title: p.title,
                        allowBackorders: !!p.allowBackorders,
                        sku: p.sku,
                        description: p.description,
                        image: p.image,
                        regularPrice: p.regularPrice,
                        cost: Math.max(...Object.values(p.cost)),
                        stockData: p.stockData,
                        isAffiliate: false,
                        subtotal: 0,
                        categories: p.categories ?? [],
                    }))
                ];
                setProducts(all);
            } catch (e: any) {
                toast.error(e?.message || "Failed loading products");
            } finally {
                setProductsLoading(false);
            }
        })();
    }, []);

    /* Search (remote) */
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
                    fetch(`/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=20`)
                        .then((r) => r.json())
                        .then((d) => d.products as any[]),
                    fetch(`/api/affiliate/products?search=${encodeURIComponent(q)}&limit=20`)
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

    const filteredProducts = useMemo(() => {
        const q = prodTerm.trim();
        if (q.length < 3) return products;
        const qq = q.toLowerCase();
        return products.filter(
            (p) => p.title.toLowerCase().includes(qq) || p.sku.toLowerCase().includes(qq)
        );
    }, [products, prodTerm]);

    const totalSelectedQty = useMemo(
        () => orderItems.reduce((sum, it) => sum + Number(it.quantity ?? 0), 0),
        [orderItems]
    );

    /* Cart create & reload */
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
                const msg = await resC.text().catch(() => "Failed to create suppliers cart");
                throw new Error(msg);
            }
            const dataC = await resC.json();
            const { newCart } = dataC;
            setCartId(newCart.id);

            await reloadCartLines(newCart.id);
            setOrderGenerated(true);
            toast.success("Suppliers cart created");
        } catch (err: any) {
            toast.error(err?.message || "Could not create suppliers cart");
        }
    };

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
            setAddedProductIds(new Set(mapped.map((m) => m.product.id)));
        } catch (e: any) {
            toast.error(e?.message || "Could not refresh cart items");
        }
    };

    /* Quick add product (NO drawer) */
    const handleQuickAddProduct = async () => {
        if (isLocked) return toast.error("This order is completed and cannot be modified");
        if (!orderGenerated || !cartId) {
            toast.error("Generate the suppliers cart first");
            return;
        }
        if (!selectedProduct) {
            toast.error("Select a product first");
            return;
        }
        if (addedProductIds.has(selectedProduct)) {
            toast.info("This product is already in the cart");
            return;
        }

        try {
            const whs = await ensureWarehouses();
            const allocations = whs.flatMap((w) =>
                w.countries.map((c) => ({
                    warehouseId: w.id,
                    country: c,
                    quantity: 0,
                    unitCost: 0,
                }))
            );

            const res = await fetch(`/api/suppliersCart/${cartId}/add-product`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ productId: selectedProduct, allocations }),
            });
            if (!res.ok) {
                const msg = await res.text().catch(() => "Failed to add product");
                throw new Error(msg);
            }

            setAddedProductIds((prev) => {
                const next = new Set(prev);
                next.add(selectedProduct);
                return next;
            });

            await reloadCartLines(cartId);
            setSelectedProduct("");
            toast.success("Product added to cart");
        } catch (err: any) {
            toast.error(err?.message || "Could not add product");
        }
    };

    /* Edit flow (Drawer) */
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

    const handleEditClick = async (productId: string) => {
        if (isLocked) return toast.error("This order is completed and cannot be modified");
        if (!orderGenerated || !cartId) {
            toast.error("Generate the suppliers cart first");
            return;
        }
        try {
            setSelectedProduct(productId);
            setEditingProductId(productId);

            const wRes = await fetch("/api/warehouses", {
                headers: {
                    "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
                },
            });
            if (!wRes.ok) throw new Error("Failed to load warehouses");
            const wData = await wRes.json();
            const whs: Warehouse[] = wData?.warehouses ?? [];
            setWarehouses(whs);

            const aRes = await fetch(`/api/suppliersCart/product/${productId}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store",
            });
            if (!aRes.ok) throw new Error("Failed to load product allocations");

            // Response has two objects: `result` (allocations) and `cost` (per-country costs).
            const json = await aRes.json().catch(() => ({} as any));
            const rows = normalizeAllocationsPayload(json?.result);
            // Extract country → cost map robustly (accept {cost:{CL:..}} or {CL:..})
            const rawCost = json?.stock.cost ?? {};
            const countryCostMap: Record<string, number> =
                (rawCost?.cost ?? rawCost) || {};

            // Seed the editable grid with default costs for every warehouse/country
            const zero: Record<string, Record<string, { qty: number; cost: number }>> = {};
            for (const w of whs) {
                zero[w.id] = {};
                for (const c of w.countries) {
                    const suggested = Number(countryCostMap?.[c] ?? 0) || 0;
                    zero[w.id][c] = { qty: 0, cost: suggested };
                }
            }

            // Apply existing allocations (keep qty; cost falls back to suggested cost for that country)
            for (const r of rows) {
                if (!r.warehouseId || !r.country) continue;
                if (!zero[r.warehouseId]) zero[r.warehouseId] = {};
                const suggested = Number(countryCostMap?.[r.country] ?? 0) || 0;
                const qty = Number(r.quantity || 0);
                const cost = qty > 0 ? (Number(r.unitCost) || suggested) : suggested;
                zero[r.warehouseId][r.country] = { qty, cost };
            }

            setEditable(zero);
            setDrawerOpen(true);
        } catch (err: any) {
            console.error("Edit drawer error:", err);
            toast.error(err?.message || "Could not open edit drawer");
            setEditingProductId(null);
        }
    };

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
                    sum + Object.values(byCt).reduce((s, v) => s + (Number(v?.qty) || 0), 0),
                0
            ),
        [editable]
    );

    /* Save allocations (PATCH edit) */
    const saveAllocations = async () => {
        if (!cartId || !editingProductId) {
            toast.error("Nothing to save");
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
            const res = await fetch(`/api/suppliersCart/product/${editingProductId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    supplierCartId: cartId,
                    productId: editingProductId,
                    allocations,
                }),
            });

            if (!res.ok) throw new Error(await res.text());

            await reloadCartLines(cartId);
            setDrawerOpen(false);
            setEditingProductId(null);
            toast.success("Allocations updated");
        } catch (e: any) {
            toast.error(e?.message || "Could not save allocations");
        } finally {
            setAdding(false);
        }
    };

    // Create / update order (expectedAt required ONLY when not a draft)
    const completeOrder = async (isDraft: boolean, submitAction: "save_draft" | "place_order") => {
        if (!orderGenerated || !cartId) return toast.error("Generate a cart first");
        if (!selectedSupplierId) return toast.error("Select a supplier");
        if (!isDraft && !expectedAt) return toast.error("Choose an expected date");
        if (isLocked) return toast.error("This order is completed and cannot be modified");

        try {
            const payload: any = {
                supplierId: selectedSupplierId,
                supplierCartId: cartId,
                note: notes || "",
                draft: isDraft,
                submitAction
            };
            if (expectedAt) payload.expectedAt = expectedAt.toISOString();

            const url = currentOrderId
                ? `/api/suppliersOrder/${currentOrderId}`
                : `/api/suppliersOrder`;
            const method = currentOrderId ? "PATCH" : "POST";

            const res = await fetch(url, {
                method,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            if (!res.ok) throw new Error(await res.text());

            const data = await res.json().catch(() => ({}));
            if (!currentOrderId) {
                const created = data.order ?? data.supplier ?? data;
                if (created?.id) setCurrentOrderId(created.id);
                setOrderStatus(created?.draft ? "draft" : created?.status ?? "pending");
            } else {
                setOrderStatus(isDraft ? "draft" : "pending");
            }

            toast.success(isDraft ? "Draft saved" : "Purchase order saved");
            router.push("/supplier-order");
        } catch (err: any) {
            toast.error(err?.message || "Request failed");
        }
    };


    // Build 2-letter initials from a product title
    function getInitials(name: string): string {
        return name
            .split(" ")
            .filter(Boolean)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? "")
            .join("");
    }

    /* Render */
    return (
        <div className="container mx-auto py-6">
            <h1 className="text-3xl font-bold mb-6">Purchase Order (Supply)</h1>
            <div className="mb-4">
                <Button variant="outline" onClick={() => router.push("/supplier-order")}>
                    <ArrowLeft className="mr-2 h-4 w-4" /> Go back
                </Button>
            </div>

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
                                    disabled={orderGenerated || !!currentOrderId || isLocked}
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
                                    disabled={!selectedSupplierId || orderGenerated || !!currentOrderId || isLocked}
                                >
                                    Generate Order
                                </Button>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Product Selection */}
                    <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
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
                                                    <div className="relative h-10 w-10 flex-shrink-0">
                                                        <Skeleton className="h-10 w-10 rounded-full" />
                                                        <span
                                                            className="
                                                          absolute inset-0 grid place-items-center
                                                          text-xs font-medium text-muted-foreground
                                                        "
                                                        >
                                                            {getInitials(product.title)}
                                                        </span>
                                                    </div>
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
                                                        disabled={isPending}
                                                    >
                                                        <span>{quantity ?? 0}</span>
                                                        <Edit className="h-4 w-4 text-gray-500" />
                                                    </Button>
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        title="Remove (not implemented)"
                                                        className="flex items-center space-x-1"
                                                        onClick={() => {
                                                            toast.info("Remove functionality not implemented yet");
                                                        }}
                                                        disabled={isPending}
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Picker + Add button (NO drawer) */}
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="flex-1">
                                    <Label>Select Product</Label>
                                    <Select
                                        value={selectedProduct}
                                        onValueChange={(val) => {
                                            setSelectedProduct(val);
                                            setProdTerm("");
                                            setProdResults([]);
                                        }}
                                        disabled={productsLoading}
                                    >
                                        <SelectTrigger>
                                            <SelectValue
                                                placeholder={productsLoading ? "Loading…" : "Select a product"}
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
                                                        {items.map((p) => {
                                                            const disabled = addedProductIds.has(p.id);
                                                            return (
                                                                <SelectItem key={p.id} value={p.id} disabled={disabled}>
                                                                    {p.title} — ${p.cost}
                                                                    {disabled ? " (added)" : ""}
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
                                                            .map((p) => {
                                                                const disabled = addedProductIds.has(p.id);
                                                                return (
                                                                    <SelectItem key={p.id} value={p.id} disabled={disabled}>
                                                                        {p.title} — {p.price} pts
                                                                        {disabled ? " (added)" : ""}
                                                                    </SelectItem>
                                                                );
                                                            })}
                                                        <SelectSeparator />
                                                    </SelectGroup>
                                                )}

                                                {/* Remote results (not yet cached) */}
                                                {prodResults.length > 0 && (
                                                    <>
                                                        {groupByCategory(
                                                            prodResults.filter(
                                                                (p) => !p.isAffiliate && !products.some((lp) => lp.id === p.id)
                                                            )
                                                        ).map(([label, items]) => (
                                                            <SelectGroup key={`remote-${label}`}>
                                                                <SelectLabel>{label} — search</SelectLabel>
                                                                {items.map((p) => {
                                                                    const disabled = addedProductIds.has(p.id);
                                                                    return (
                                                                        <SelectItem
                                                                            key={p.id}
                                                                            value={p.id}
                                                                            disabled={disabled}
                                                                        >
                                                                            {p.title} — ${p.price}
                                                                            <span className="ml-1 text-xs text-muted-foreground">
                                                                                (remote)
                                                                            </span>
                                                                            {disabled ? " (added)" : ""}
                                                                        </SelectItem>
                                                                    );
                                                                })}
                                                                <SelectSeparator />
                                                            </SelectGroup>
                                                        ))}

                                                        {/* Remote affiliate results */}
                                                        {prodResults.some(
                                                            (p) => p.isAffiliate && !products.some((lp) => lp.id === p.id)
                                                        ) && (
                                                                <SelectGroup>
                                                                    <SelectLabel>Affiliate — search</SelectLabel>
                                                                    {prodResults
                                                                        .filter(
                                                                            (p) =>
                                                                                p.isAffiliate && !products.some((lp) => lp.id === p.id)
                                                                        )
                                                                        .map((p) => {
                                                                            const disabled = addedProductIds.has(p.id);
                                                                            return (
                                                                                <SelectItem
                                                                                    key={p.id}
                                                                                    value={p.id}
                                                                                    disabled={disabled}
                                                                                >
                                                                                    {p.title} — {p.price} pts
                                                                                    <span className="ml-1 text-xs text-muted-foreground">
                                                                                        (remote)
                                                                                    </span>
                                                                                    {disabled ? " (added)" : ""}
                                                                                </SelectItem>
                                                                            );
                                                                        })}
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

                                {/* Quick Add (no drawer) */}
                                <div className="flex items-end">
                                    <Button
                                        onClick={handleQuickAddProduct}
                                        disabled={
                                            !selectedProduct ||
                                            !orderGenerated ||
                                            addedProductIds.has(selectedProduct) ||
                                            isLocked || isPending
                                        }
                                    >
                                        <Plus className="h-4 w-4 mr-2" /> Add Product
                                    </Button>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Notes */}
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
                                disabled={!orderGenerated || orderItems.length === 0 || isLocked || isPending}
                            />
                        </CardContent>
                    </Card>
                </div>

                {/* RIGHT – summary */}
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
                                            disabled={!selectedSupplierId || isPending}
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
                                            disabled={(date) => {
                                                const today = new Date()
                                                today.setHours(0, 0, 0, 0)      // start of today
                                                const d = new Date(date)
                                                d.setHours(0, 0, 0, 0)
                                                return d <= today               // disable today and any past date
                                            }}
                                            initialFocus
                                        />
                                    </PopoverContent>
                                </Popover>
                                {!selectedSupplierId && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Select a supplier to choose a date.
                                    </p>
                                )}
                            </div>                                                        {/* Buttons on one line */}
                            <div className="flex w-full items-center justify-center gap-2">
                                <Button
                                    variant="outline"
                                    onClick={() => completeOrder(true, "save_draft")}
                                    disabled={!orderGenerated || orderItems.length === 0 || isLocked}
                                >
                                    Save as draft
                                </Button>
                                <Button
                                    onClick={() => completeOrder(false, "place_order")}
                                    disabled={!orderGenerated || orderItems.length === 0 || !expectedAt || isLocked}
                                >
                                    Place Order
                                </Button>
                            </div>
                            <p className="text-xs text-muted-foreground text-center">
                                Generate a cart, add products, pick an expected date, then place the
                                order.
                            </p>
                        </CardFooter>
                    </Card>
                </div>
            </div>

            {/* Drawer (Edit allocations only) */}
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
                                        ? [...products, ...prodResults].find((p) => p.id === selectedProduct)
                                            ?.title
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

                    <div className="overflow-y-auto px-6 py-4 h-[calc(85vh-9rem)] sm:h-[calc(85vh-9rem)]">
                        {warehouses.length === 0 ? (
                            <p className="text-sm text-muted-foreground">No warehouses found.</p>
                        ) : (
                            <div className="space-y-6">
                                {warehouses.map((w) => (
                                    <div key={w.id} className="space-y-3">
                                        <div className="flex items-center justify-between">
                                            <h3 className="font-medium">{w.name}</h3>
                                            <div className="flex gap-2">
                                                <Button variant="outline" size="sm" onClick={() => clearWarehouse(w.id)}>
                                                    Clear
                                                </Button>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                            {w.countries.map((c) => {
                                                const cell = editable[w.id]?.[c] || { qty: 0, cost: 0 };
                                                const qtyIsZero = (cell.qty ?? 0) === 0;

                                                return (
                                                    <div
                                                        key={`${w.id}-${c}`}
                                                        className="rounded-md border p-3 flex flex-col gap-2"
                                                    >
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
                                                                        handleCostChange(
                                                                            w.id,
                                                                            c,
                                                                            parseFloat(e.target.value) || 0
                                                                        )
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
                                disabled={adding || !selectedProduct || !cartId || isLocked}
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
