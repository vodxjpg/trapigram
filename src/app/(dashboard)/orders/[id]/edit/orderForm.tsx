// src/app/(dashboard)/orders/[id]/edit/orderForm.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  CreditCard,
  Package,
  Tag,
  DollarSign,
  Truck,
  Trash2,
  MessageSquarePlus,
  Eye, EyeOff, Trash, Loader2,
  Minus,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";

/* ——————————————————— TYPES ——————————————————— */
interface OrderFormWithFetchProps {
  orderId?: string;
}
interface Product {
  id: string;
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
  variationId?: string | null; // ⬅️ for variable products
}

interface OrderItem {
  product: Product;
  quantity: number;
  isAffiliate?: boolean;
}
interface ShippingMethod {
  id: string;
  title: string;
  description: string;
  costs: Array<{
    minOrderCost: number;
    maxOrderCost: number;
    shipmentCost: number;
  }>;
}
interface ShippingCompany {
  id: string;
  name: string;
}
interface OrderItemLine {
  id: string;
  title: string;
  sku: string;
  description: string;
  image: string;
  unitPrice: number;
  quantity: number;
  isAffiliate: boolean;
}


// ───────────────────────── NOTES ─────────────────────────
interface OrderNote {
  id: string;
  orderId: string;
  organizationId: string;
  authorRole: "client" | "staff";
  authorClientId: string | null;
  authorUserId: string | null;
  note: string;
  visibleToCustomer: boolean;
  createdAt: string; updatedAt: string;
}

const NIFTIPAY_BASE = (
  process.env.NEXT_PUBLIC_NIFTIPAY_API_URL || "https://www.niftipay.com"
).replace(/\/+$/, "");
const DEBOUNCE_MS = 400;

type NiftipayNet = { chain: string; asset: string; label: string };

const keyFor = (p: Product) => `${p.id}::${p.variationId ?? ""}`;
const parseKey = (k: string) => {
  const [id, raw] = k.split("::");
  return { id, variationId: raw ? raw : null };
};


// Mirror create-form: fetch Niftipay networks via our backend proxy
async function fetchNiftipayNetworks(): Promise<NiftipayNet[]> {
  const r = await fetch("/api/niftipay/payment-methods");
  if (!r.ok) throw new Error(await r.text().catch(() => "Niftipay methods failed"));
  const { methods } = await r.json();
  return (methods || []).map((m: any) => ({
    chain: m.chain,
    asset: m.asset,
    label: m.label ?? `${m.asset} on ${m.chain}`,
  }));
}

/* ——— Friendly errors ——— */
function showFriendlyCreateOrderError(raw?: string | null): boolean {
  const msg = (raw || "").toLowerCase();
  if (msg.includes("no shipping methods available")) {
    toast.error("You need to create a shipping method first");
    return true;
  }
  if (
    msg.includes("no shipping companies") ||
    msg.includes("shipping company required") ||
    msg.includes("missing shipping company")
  ) {
    toast.error("You need to set up a shipping company first");
    return true;
  }
  if (msg.includes("niftipay not configured for tenant")) {
    toast.error("You need to configure Niftipay or another payment method");
    return true;
  }
  if (
    msg.includes("no payment methods") ||
    msg.includes("payment method required") ||
    msg.includes("missing payment method") ||
    msg.includes("payment methods not configured")
  ) {
    toast.error("You need to set up a payment method first");
    return true;
  }
  return false;
}

/* ——— Helpers (match Create page behavior/UX) ——— */

// Sum stock across all warehouses for a specific country
const stockForCountry = (
  stockData: Product["stockData"] | undefined,
  country: string
): number =>
  Object.values(stockData || {}).reduce(
    (sum, wh) => sum + (wh?.[country] ?? 0),
    0
  );

// Quantity currently in cart for a given product
const inCartQty = (pid: string, items: OrderItem[], variationId: string | null = null) =>
  items.reduce((sum, it) => {
    if (it.product.id !== pid) return sum;
    if (variationId !== null && (it.product.variationId ?? null) !== variationId) return sum;
    return sum + it.quantity;
   }, 0);

// Aggregate server lines by product (hide price-bucket details in UI to match Create page)
function mergeLinesByProduct(
  lines: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    isAffiliate: boolean;
    variationId?: string | null;
    [key: string]: any;
  }>
) {
  const map = new Map<
    string,
    { quantity: number; subtotal: number; unitPrice: number; isAffiliate: boolean; sample: any }
  >();

  for (const l of lines) {
    const key = `${l.id}:${l.variationId ?? "null"}`; // ⬅️ keep variants separate
    if (!map.has(key)) {
      map.set(key, {
        quantity: 0,
        subtotal: 0,
        unitPrice: l.unitPrice,
        isAffiliate: l.isAffiliate,
        sample: l, // carries variationId
      });
    }
    const acc = map.get(key)!;
    acc.quantity += l.quantity;
    acc.subtotal += l.subtotal;
  }

  return Array.from(map.values()).map((v) => ({
    id: v.sample.id,
    variationId: v.sample.variationId ?? null, // ⬅️ surface it
    quantity: v.quantity,
    subtotal: v.subtotal,
    unitPrice: v.unitPrice,
    isAffiliate: v.isAffiliate,
    sample: v.sample,
  }));
}


async function fetchJsonVerbose(url: string, opts: RequestInit = {}, tag = url) {
  const res = await fetch(url, { credentials: "include", ...opts });
  let body: any = null;
  try {
    body = await res.clone().json();
  } catch { }
  console.log(`[${tag}]`, res.status, body ?? "(non-json)");
  return res;
}

export default function OrderFormVisual({ orderId }: OrderFormWithFetchProps) {
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const merchantId = activeOrg?.id ?? "";
  const { data: session } = (authClient as any).useSession?.() || {};
  const currentUserId: string | null = session?.user?.id ?? null;
  const canEditNotes = true; // edit page implies update rights already

  /* ——————————————————— STATE ——————————————————— */
  const [orderData, setOrderData] = useState<any | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [clientCountry, setClientCountry] = useState("");
  const [cartId, setCartId] = useState("");

  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/product-categories?all=1").catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const rows: Array<{ id: string; name: string }> =
            data.categories ?? data.items ?? [];
          setCategoryMap(Object.fromEntries(rows.map((c) => [c.id, c.name])));
          return;
        }
        // fallback pagination
        let page = 1;
        const pageSize = 200;
        const acc: Array<{ id: string; name: string }> = [];
        while (true) {
          const r = await fetch(`/api/product-categories?page=${page}&pageSize=${pageSize}`).catch(() => null);
          if (!r || !r.ok) break;
          const data = await r.json().catch(() => ({}));
          const rows = Array.isArray(data.categories) ? data.categories : [];
          acc.push(...rows.map((c: any) => ({ id: c.id, name: c.name })));
          const totalPages = Number(data.totalPages || 1);
          if (page >= totalPages) break;
          page += 1;
        }
        if (acc.length) {
          setCategoryMap(Object.fromEntries(acc.map((c) => [c.id, c.name])));
        }
      } catch { }
    })();
  }, []);

  const categoryLabel = (id?: string) =>
    id ? (categoryMap[id] || id) : "Uncategorized";

  const groupByCategory = (arr: Product[]) => {
    const buckets: Record<string, Product[]> = {};
    for (const p of arr) {
      if (p.isAffiliate) continue;
      const firstCat = p.categories?.[0];
      const label = categoryLabel(firstCat);
      (buckets[label] ??= []).push(p);
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => [label, items.sort((x, y) => x.title.localeCompare(y.title))] as const);
  };

  const [productsLoading, setProductsLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<string>(""); // holds `${productId}::${variationId}`


  // keep text while typing; coerce on blur/use
  const [quantityText, setQuantityText] = useState("1");
  const parseQty = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };

  /* ▼ product-search state (local + remote) */
  const [prodTerm, setProdTerm] = useState("");
  const [prodSearching, setProdSearching] = useState(false);
  const [prodResults, setProdResults] = useState<Product[]>([]);

  const [addresses, setAddresses] = useState<{ id: string; address: string }[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [newAddress, setNewAddress] = useState("");

  const [showNewCoupon, setShowNewCoupon] = useState(false);
  const [newCoupon, setNewCoupon] = useState("");

  const [couponApplied, setCouponApplied] = useState(false);
  const [couponCode, setCouponCode] = useState("");

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("fixed");
  const [discount, setDiscount] = useState<number>(0);
  const [value, setValue] = useState<number>(0);

  const [shippingLoading, setShippingLoading] = useState(true);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>([]);
  const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
  const [selectedShippingMethod, setSelectedShippingMethod] = useState("");

  interface PaymentMethod {
    id: string;
    name: string;
    apiKey?: string | null;
    active?: boolean;
  }
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [niftipayNetworks, setNiftipayNetworks] = useState<NiftipayNet[]>([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);
  const [selectedNiftipay, setSelectedNiftipay] = useState(""); // "chain:asset"

  // ───────────── Notes state ─────────────
  const [notesScope, setNotesScope] = useState<"staff" | "customer">("staff");
  const [notesLoading, setNotesLoading] = useState<boolean>(true);
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [newNote, setNewNote] = useState<string>("");
  const [newNotePublic, setNewNotePublic] = useState<boolean>(false);
  const [creatingNote, setCreatingNote] = useState<boolean>(false);
  const fetchNotes = useCallback(async () => {
    if (!orderId) return; setNotesLoading(true);
    try {
      const r = await fetch(`/api/order/${orderId}/notes?scope=${notesScope}`);
      const d = await r.json(); setNotes(Array.isArray(d.notes) ? d.notes : []);
    } catch { setNotes([]); } finally { setNotesLoading(false); }
  }, [orderId, notesScope]);

  /* ——————————————————— HELPERS ——————————————————— */
  // Variant-aware lookup (parent id + variation id)
  const findProduct = (id: string, variationId: string | null = null) =>
    [...products, ...prodResults].find(
      (p) => p.id === id && (p.variationId ?? null) === (variationId ?? null)
    );
  const calcRowSubtotal = (p: Product, qty: number) =>
    (p.regularPrice[clientCountry] ?? p.price) * qty;

  async function loadCart() {
    try {
      const res = await fetch(`/api/cart/${cartId}`, {
        headers: { "Content-Type": "application/json" },
      });
      const { resultCartProducts } = await res.json();

      // Aggregate like Create page UI (one row per product)
      const aggregated = mergeLinesByProduct(resultCartProducts);

      // Map to <OrderItem>, hydrating stock/flags from catalog when available
      const items: OrderItem[] = aggregated.map((l) => {
        const pMatch = findProduct(l.id, l.variationId ?? null);
        return {
          product: {
            id: l.id,
            variationId: l.variationId ?? null, // ⬅️ keep it on the product
            title: pMatch?.title ?? l.sample.title,
            sku: l.sample.sku,
            description: l.sample.description,
            image: l.sample.image,
            regularPrice: pMatch?.regularPrice ?? {},
            price: l.unitPrice,
            stockData: pMatch?.stockData ?? {},
            subtotal: l.subtotal,
            allowBackorders: pMatch?.allowBackorders,
            isAffiliate: l.isAffiliate,
            categories: pMatch?.categories ?? [],
          },
          quantity: l.quantity,
          isAffiliate: l.isAffiliate,
        };
      });
      setOrderItems(items);

    } catch (e: any) {
      toast.error(e.message || "Failed loading cart");
    }
  }

  /* ——————————————————— EFFECTS ——————————————————— */
  useEffect(() => {
    const sum = orderItems
      .filter((item) => !item.isAffiliate)
      .reduce(
        (acc, item) => acc + (item.product.subtotal ?? calcRowSubtotal(item.product, item.quantity)),
        0
      );
    setSubtotal(sum);
  }, [orderItems, clientCountry]);

  // total recalculation (keep existing behavior on edit)
  useEffect(() => {
    if (!orderData) return;
    const shipping = orderData.shipping ?? 0;
    const couponDisc = couponApplied ? discount : (orderData.discount ?? 0);
    const pointsDisc = orderData.pointsRedeemedAmount ?? 0;

    setDiscountType(couponApplied ? discountType : orderData.discountType);
    setDiscount(Number(couponDisc));

    setTotal(subtotal + shipping - Number(couponDisc) - Number(pointsDisc));
  }, [
    subtotal,
    orderData?.shipping,
    orderData?.discount,
    orderData?.pointsRedeemedAmount,
    couponApplied,
    discountType,
  ]);

  /* ——————————————————— FETCH ORDER + ADDRESSES ——————————————————— */
  useEffect(() => {
    if (!orderId) return;
    (async () => {
      try {
        const res = await fetch(
          `/api/order/${orderId}?organizationId=${activeOrg?.id}`,
          { credentials: "include" }
        );
        const data = await res.json();
        setOrderData(data);
        setClientCountry(data.country);
        setCartId(data.cartId);
        setDiscount(Number(data.discount ?? 0));
        setValue(Number(data.discountValue ?? 0));
        setDiscountType(data.discountType);
        setSubtotal(data.subtotal);
        setTotal(data.total);

        const addrRes = await fetch(`/api/clients/${data.clientId}/address`);
        const addrData = await addrRes.json();
        setAddresses(addrData.addresses);

        const match = addrData.addresses.find(
          (a: any) => a.address === data.shippingInfo.address
        );
        if (match) setSelectedAddressId(match.id);
      } catch {
        toast.error("Failed to load order or addresses");
      }
    })();
  }, [orderId]);

  /* ——————————————————— FETCH CART ITEMS ——————————————————— */
  useEffect(() => {
    if (!cartId) return;
    loadCart();
  }, [cartId, clientCountry]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  /* ——————————————————— LOAD STATIC DATA ——————————————————— */
  useEffect(() => {
    loadProducts();
    loadShipping();
  }, []);

  async function loadProducts() {
    setProductsLoading(true);
    try {
      const [normRes, affRes] = await Promise.all([
        fetch("/api/products?page=1&pageSize=1000"),
        fetch("/api/affiliate/products?limit=1000"),
      ]);
      if (!normRes.ok || !affRes.ok) {
        throw new Error("Failed to fetch product lists");
      }

      const { productsFlat: normFlat } = await normRes.json();
      const { products: aff } = await affRes.json();
      const all: Product[] = [
       // each variation becomes a selectable row (title already includes the variant label)
       ...normFlat.map((p: any) => ({
         id: p.productId,                  // parent id
         variationId: p.variationId ?? null,
         allowBackorders: !!p.allowBackorders,
         title: p.title,                   // already “Product – Color Red, Size L” etc.
         sku: p.sku,
         description: p.description,
         image: p.image,
         regularPrice: p.regularPrice,     // per-variation price map
         price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
         stockData: p.stockData,           // per-variation stock
         isAffiliate: false,
         subtotal: 0,
         categories: p.categories ?? [],
       })),
        ...aff.map((a: any) => {
          const lvlKeys = Object.keys(a.pointsPrice ?? {});
          const countryKeys = lvlKeys.length ? Object.keys(a.pointsPrice[lvlKeys[0]] ?? {}) : [];
          const firstCountry = countryKeys[0] ?? "";
          const price = (a.cost ?? {})[firstCountry] ?? 0;

          const regularPrice: Record<string, number> = Object.fromEntries(
            Object.entries(a.cost ?? {}).map(([country, c]) => [country, c as number])
          );

          return {
            id: a.id,
            title: a.title,
            allowBackorders: false,
            sku: a.sku,
            description: a.description,
            image: a.image,
            regularPrice,
            price,
            stockData: a.stock ?? {},
            isAffiliate: true,
            subtotal: 0,
            categories: [],
          } as Product;
        }),
      ];
      // Deduplicate by (parentId::variationId) to avoid duplicate SelectItems
      const deduped = Array.from(new Map(all.map((p) => [keyFor(p), p])).values());
      setProducts(deduped);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed loading products");
    } finally {
      setProductsLoading(false);
    }
  }

  /* ────────────────────────────────────────────────────────────
   Payment methods + (if Niftipay) networks
  ───────────────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const pmRes = await fetch("/api/payment-methods");
        const { methods } = await pmRes.json();
        if (!Array.isArray(methods) || methods.length === 0) {
          toast.error("You need to set up a payment method first");
        }
        const init = methods.find(
          (m: any) =>
            m.name?.toLowerCase?.() === orderData?.shippingInfo?.payment?.toLowerCase()
        )?.id;
        if (init) setSelectedPaymentMethod(init);
        setPaymentMethods(methods);
      } catch {
        toast.error("Failed loading payment methods");
      }
    })();
  }, [orderData]);

  useEffect(() => {
    const pm = paymentMethods.find((p) => p.id === selectedPaymentMethod);
    if (!pm || !/niftipay/i.test(pm.name || "") || (pm as any).active === false) {
      setNiftipayNetworks([]);
      setSelectedNiftipay("");
      return;
    }
    (async () => {
      setNiftipayLoading(true);
      try {
        const nets = await fetchNiftipayNetworks();
        setNiftipayNetworks(nets);
        if (!selectedNiftipay && nets[0]) {
          setSelectedNiftipay(`${nets[0].chain}:${nets[0].asset}`);
        }
      } catch (err: any) {
        if (!showFriendlyCreateOrderError(err?.message)) {
          toast.error(err?.message || "Niftipay networks load error");
        }
        setNiftipayNetworks([]);
      } finally {
        setNiftipayLoading(false);
      }
    })();
  }, [selectedPaymentMethod, paymentMethods, selectedNiftipay]);

  useEffect(() => {
    if (selectedPaymentMethod) return;
    const active = (paymentMethods as any[]).filter((m) => m.active !== false);
    const nonNifti = active.find((m) => !/niftipay/i.test(m.name || ""));
    const pick = nonNifti ?? active[0] ?? paymentMethods[0];
    if (pick) setSelectedPaymentMethod(pick.id);
  }, [paymentMethods, selectedPaymentMethod]);

  /* ─── country-aware catalogue (affiliates always visible; backorders allowed) ─── */
  const countryProducts = products.filter((p) => {
    if (p.isAffiliate) return true;
    const totalStock = Object.values(p.stockData || {}).reduce(
      (sum, e: any) => sum + (e?.[clientCountry] || 0),
      0
    );
    if (totalStock > 0) return true;
    return p.allowBackorders === true;
  });

  /* ─── instant local filter while typing ─────────────────── */
  const filteredProducts = useMemo(() => {
    if (prodTerm.trim().length < 3) return countryProducts;
    const q = prodTerm.toLowerCase();
    return countryProducts.filter(
      (p) => p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [countryProducts, prodTerm]);

  /* ─── debounced remote search ── */
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
        const [shopFlat, aff] = await Promise.all([
          fetch(`/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=20`)
            .then((r) => r.json())
            .then((d) => d.productsFlat as any[]),
          fetch(`/api/affiliate/products?search=${encodeURIComponent(q)}&limit=20`)
            .then((r) => r.json())
            .then((d) => d.products as any[]),
        ]);

       const mapShop = (p: any): Product => ({
          id: p.productId,
          variationId: p.variationId ?? null,
          allowBackorders: !!p.allowBackorders,
          title: p.title,
          sku: p.sku,
          description: p.description,
          image: p.image,
          regularPrice: p.regularPrice,
          price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
          stockData: p.stockData,
          subtotal: 0,
          isAffiliate: false,
          categories: p.categories ?? [],
        });
        const mapAff = (a: any): Product => ({
          id: a.id,
          title: a.title,
          sku: a.sku,
          description: a.description,
          image: a.image,
          regularPrice: Object.fromEntries(
            Object.entries(a.cost ?? {}).map(([cc, c]) => [cc, c as number])
          ),
          price: Object.values(a.pointsPrice ?? {})[0] ?? 0,
          stockData: a.stock ?? {},
          subtotal: 0,
          isAffiliate: true,
          categories: [],
        });

         // Build, then dedupe remote results by (parentId::variationId)
        const combined = [...shopFlat.map(mapShop), ...aff.map(mapAff)];
        const unique = Array.from(new Map(combined.map((p) => [keyFor(p), p])).values());
        setProdResults(unique);
      } catch {
        setProdResults([]);
      } finally {
        setProdSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [prodTerm]);

  /* helper: keep remote rows in `products` so Select can resolve labels */
  const pickProduct = (value: string, obj: Product) => {
    // value is `${productId}::${variationId}`
    setSelectedProduct(value);
    // Avoid injecting duplicates into products
    if (!products.some((p) => keyFor(p) === value)) setProducts((prev) => [...prev, obj]);
    setProdTerm("");
    setProdResults([]);
  };

  const loadShipping = async () => {
    setShippingLoading(true);
    try {
      const [shipRes, compRes] = await Promise.all([fetch("/api/shipments"), fetch("/api/shipping-companies")]);
      const shipData = await shipRes.json();
      const compData = await compRes.json();
      setShippingMethods(shipData.shipments);
      if (!shipData?.shipments?.length) {
        toast.error("You need to create a shipping method first");
      }
      const companies: ShippingCompany[] = compData?.companies ?? compData?.shippingMethods ?? [];
      setShippingCompanies(companies);
      if (!companies.length) {
        toast.error("You need to set up a shipping company first");
      }
    } catch (err: any) {
      if (!showFriendlyCreateOrderError(err?.message)) {
        toast.error(err?.message || "Shipping load error");
      }
    } finally {
      setShippingLoading(false);
    }
  };

  // Auto-select shipping method/company from order
  useEffect(() => {
    if (orderData && shippingMethods.length) {
      const match = shippingMethods.find(
        (m) => m.id === orderData.shippingInfo.method || m.title === orderData.shippingInfo.method
      );
      if (match) setSelectedShippingMethod(match.id);
    }
  }, [orderData, shippingMethods]);

  useEffect(() => {
    if (orderData && shippingCompanies.length) {
      const match = shippingCompanies.find(
        (c) => c.id === orderData.shippingInfo.company || c.name === orderData.shippingInfo.company
      );
      if (match) setSelectedShippingCompany(match.id);
    }
  }, [orderData, shippingCompanies]);

  // Add new address then re-fetch list and select it
  const handleAddAddress = async () => {
    if (!newAddress || !orderData?.clientId) return;
    const newAddrText = newAddress;
    try {
      const res = await fetch(`/api/clients/${orderData.clientId}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: newAddrText }),
      });
      if (!res.ok) throw new Error("Failed to add address");
      setNewAddress("");

      const upd = await fetch(`/api/clients/${orderData.clientId}/address`);
      const addrData = await upd.json();
      setAddresses(addrData.addresses);

      const match = addrData.addresses.find((a: any) => a.address === newAddrText);
      if (match) setSelectedAddressId(match.id);
    } catch (err: any) {
      console.error(err);
      toast.error("Could not add address");
    }
  };

  // Apply coupon (single field on edit)
  const handleApplyCoupon = async () => {
    if (!newCoupon || !orderData?.cartId || !orderData?.id) return;
    try {
      const patchRes = await fetch(`/api/cart/${orderData.cartId}/apply-coupon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCoupon, total: subtotal }),
      });
      if (!patchRes.ok) throw new Error("Failed to apply coupon to cart");
      const data = await patchRes.json();
      const { discountAmount: amt, discountType: dt, discountValue: dv, cc } = data;

      if (cc === null) {
        setCouponCode("");
        setCouponApplied(false);
        toast.error("Coupon can't be applied!");
      } else {
        setDiscount(amt);
        setValue(dv);
        setDiscountType(dt);
        setCouponApplied(true);
        toast.success("Coupon applied!");
      }
      setNewCoupon(newCoupon);
      setShowNewCoupon(true);
    } catch (err) {
      console.error(err);
    }
  };

  /* ——————————————————— PRODUCTS: Add/Remove/Update ——————————————————— */

  // Add product (guard like Create page)
  const addProduct = async () => {
    if (!selectedProduct || !cartId) {
      toast.error("Cart hasn’t been created yet!");
      return;
    }

    const { id: productId, variationId } = parseKey(selectedProduct);
    const product = [...products, ...prodResults].find(
      (p) => p.id === productId && (p.variationId ?? "") === (variationId ?? "")
    );
    if (!product) return;

    const hasFiniteStock = Object.keys(product.stockData || {}).length > 0;
    const base = stockForCountry(product.stockData, clientCountry);
    const already = inCartQty(product.id, orderItems, product.variationId ?? null);
    const remaining = hasFiniteStock ? Math.max(0, base - already) : Infinity;

    const qty = parseQty(quantityText);
    if (hasFiniteStock && !product.allowBackorders && (remaining === 0 || qty > remaining)) {
      toast.error(remaining === 0 ? "Out of stock" : `Only ${remaining} available`);
      return;
    }

    const unitPrice = product.regularPrice[clientCountry] ?? product.price;

    try {
      const res: Response = await fetch(`/api/cart/${cartId}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
         variationId: product.variationId ?? null,
          quantity: qty,
          price: unitPrice, // (edit route expects "price")
          country: clientCountry,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const msg =
          (body.error as string) ??
          (body.message as string) ??
          "Failed to add product";
        throw new Error(msg);
      }

      await loadCart();
      setSelectedProduct("");
      setQuantityText("1");
      toast.success("Product added to cart!");
    } catch (error: any) {
      console.error("addProduct error:", error);
      toast.error(error.message || "Could not add product");
    }
  };

  // Remove product
  const removeProduct = async (productId: string, variationId: string | null) => {
      if (!cartId) {
        toast.error("No cart created yet!");
        return;
      }
      try {
        const res = await fetch(`/api/cart/${cartId}/remove-product`, {
          method: "POST", // or DELETE
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ productId, variationId }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          const msg =
            (body.error as string) ??
            (body.message as string) ??
            "Failed to remove product";
          throw new Error(msg);
        }
        await loadCart();
        toast.success("Product removed from cart");
      } catch (error: any) {
        console.error("removeProduct error:", error);
        toast.error(error.message || "Could not remove product");
      }
    };

    // Update product quantity
    const updateQuantity = async (productId: string, variationId: string | null, action: "add" | "subtract") => {
      if (!cartId) {
        toast.error("Cart hasn’t been created yet!");
        return;
      }
      try {
        const res = await fetch(`/api/cart/${cartId}/update-product`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ productId, variationId, action }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          console.error("PATCH /order failed", body);
          throw new Error(body.error || "Failed to update quantity");
        }
        // Server returns { lines: [...] }
        const { lines } = await res.json();

        // aggregate to match Create page UI
        const aggregated = mergeLinesByProduct(lines);
        const mapped: OrderItem[] = aggregated.map((l: any) => {
        const prev = orderItems.find(
          (it) => it.product.id === l.id && (it.product.variationId ?? null) === (l.variationId ?? null)
        );
        const pMatch = findProduct(l.id, l.variationId ?? null);
            return {
              product: {
                id: l.id,
                variationId: l.variationId ?? null,              // <— keep variant
                title: pMatch?.title ?? l.sample.title,
                sku: l.sample.sku,
                description: l.sample.description,
                image: l.sample.image,
                price: l.unitPrice,
                regularPrice: { [clientCountry]: l.unitPrice, ...(pMatch?.regularPrice ?? {}) },
                stockData: prev?.product.stockData ?? pMatch?.stockData ?? {},
                allowBackorders: prev?.product.allowBackorders ?? pMatch?.allowBackorders,
                subtotal: l.subtotal,
                categories: pMatch?.categories ?? [],
                isAffiliate: l.isAffiliate,
              } as Product,
              quantity: l.quantity,
              isAffiliate: l.isAffiliate,
            };
          });


        setOrderItems(mapped);
        toast.success(`Quantity ${action === "add" ? "increased" : "decreased"}!`);
      } catch (err: any) {
        toast.error(err.message);
      }
    };

    // Update order (shipping/payment etc.)
    const handleUpdateOrder = async () => {
      if (!orderData?.id) return;

      try {
        const pmObj = paymentMethods.find((p) => p.id === selectedPaymentMethod);
        const oldPM = orderData.shippingInfo.payment?.toLowerCase();
        const newPM = pmObj?.name.toLowerCase();

        const prevNA =
          orderData.orderMeta?.[0]?.order
            ? `${orderData.orderMeta[0].order.network}:${orderData.orderMeta[0].order.asset}`
            : null;

        const needDelete =
          oldPM === "niftipay" &&
          ((newPM !== "niftipay") ||
            (newPM === "niftipay" && prevNA && selectedNiftipay && selectedNiftipay !== prevNA));

        if (needDelete) {
          const niftipayMethod = paymentMethods.find((p) => p.name.toLowerCase() === "niftipay");
          const key = niftipayMethod?.apiKey;
          if (!key) {
            toast.error("Niftipay API key missing");
            return;
          }
          const findRes = await fetchJsonVerbose(
            `${NIFTIPAY_BASE}/api/orders?reference=${encodeURIComponent(orderData.orderKey)}`,
            { credentials: "omit", headers: { "x-api-key": key } },
            "Niftipay FIND by reference"
          );
          if (!findRes.ok) {
            toast.error("Could not look up Niftipay invoice");
            return;
          }
          const { orders: found = [] } = await findRes.clone().json().catch(() => ({ orders: [] }));
          const existing = found.find((o: any) => o.reference === orderData.orderKey);
          if (existing && existing.status !== "cancelled") {
            const patch = await fetchJsonVerbose(
              `${NIFTIPAY_BASE}/api/orders/${existing.id}`,
              {
                method: "PATCH",
                credentials: "omit",
                headers: { "Content-Type": "application/json", "x-api-key": key },
                body: JSON.stringify({ status: "cancelled" }),
              },
              "Niftipay CANCEL"
            );
            if (!patch.ok) {
              const err = await patch.json().catch(() => ({}));
              toast.error(err.error || "Failed to cancel previous Niftipay invoice");
              return;
            }
            toast.success("Previous crypto invoice cancelled");
          }
        }

        const selectedAddressText = addresses.find((a) => a.id === selectedAddressId)?.address ?? null;

        const res = await fetchJsonVerbose(
          `/api/order/${orderData.id}?organizationId=${activeOrg?.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              discount: discount ? Number(discount) : orderData.discount,
              couponCode: newCoupon || orderData.coupon,
              address: selectedAddressText,
              total,
              shippingMethod: selectedShippingMethod,
              shippingCompany: selectedShippingCompany,
              paymentMethodId: selectedPaymentMethod,
            }),
          }
        );

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const rawMsg = err?.error ?? `Request failed (${res.status})`;
          if (!showFriendlyCreateOrderError(rawMsg)) {
            toast.error(rawMsg);
          }
          return;
        }

        if (newPM === "niftipay") {
          if (!niftipayNetworks.length) {
            toast.error("Niftipay isn’t configured. Choose another payment method.");
            return;
          }
          const key = pmObj?.apiKey;
          if (!key) {
            toast.error("Niftipay API key missing");
            return;
          } else if (!selectedNiftipay) {
            toast.error("Select crypto network/asset first");
            return;
          }

          const [chain, asset] = selectedNiftipay.split(":");
          await fetchJsonVerbose(
            `${NIFTIPAY_BASE}/api/orders?reference=${encodeURIComponent(orderData.orderKey)}`,
            {
              credentials: "omit",
              method: "DELETE",
              headers: { "x-api-key": key },
            },
            "DELETE OLD Niftipay"
          );

          const niftipayRes = await fetch(`${NIFTIPAY_BASE}/api/orders?replaceCancelled=1`, {
            method: "POST",
            credentials: "omit",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": pmObj!.apiKey!,
            },
            body: JSON.stringify({
              network: chain,
              asset,
              amount: total,
              currency: orderData.currency ?? "EUR",
              firstName: orderData.client.firstName,
              lastName: orderData.client.lastName,
              email: orderData.client.email || "user@trapyfy.com",
              merchantId,
              reference: orderData.orderKey,
            }),
          });

          if (!niftipayRes.ok) {
            const errorBody = await niftipayRes.json().catch(() => ({ error: "Unknown error" }));
            const rawMsg = errorBody?.error;
            if (!showFriendlyCreateOrderError(rawMsg)) {
              toast.error(rawMsg || "Failed to create new Niftipay order");
            }
            return;
          }

          const niftipayMeta = await niftipayRes.json();
          await fetch(`/api/order/${orderData.id}?organizationId=${activeOrg?.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderMeta: [niftipayMeta] }),
          });
          toast.success(`Niftipay invoice created: send ${niftipayMeta.order.amount} ${asset}`);
        }

        toast.success("Order updated!");
        router.push("/orders");
      } catch (err: any) {
        if (!showFriendlyCreateOrderError(err?.message)) {
          toast.error(err?.message || "Update failed");
        }
      }
    };

    // ───────────── Notes mutations ─────────────
    const createNote = async () => {
      if (!orderId || !newNote.trim() || !currentUserId) return;
      setCreatingNote(true);
      try {
        const res = await fetch(`/api/order/${orderId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            note: newNote,
            visibleToCustomer: newNotePublic,
            authorRole: "staff",
            authorUserId: currentUserId,
          }),
        });
        if (!res.ok) throw new Error("Failed to create note");
        setNewNote(""); setNewNotePublic(false);
        await fetchNotes();
      } finally { setCreatingNote(false); }
    };
    const toggleNoteVisibility = async (noteId: string, visible: boolean) => {
      await fetch(`/api/order-notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibleToCustomer: visible }),
      });
      await fetchNotes();
    };
    const deleteNote = async (noteId: string) => {
      await fetch(`/api/order-notes/${noteId}`, { method: "DELETE" });
      await fetchNotes();
    };

    /* ——————————————————— RENDER ——————————————————— */
    return (
      <div className="container mx-auto py-6">
        <h1 className="text-3xl font-bold mb-6">Update Order</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT COLUMN */}
          <div className="lg:col-span-2 space-y-6">
            {/* Order information (keep this card) */}
            <Card>
              <CardHeader>
                <CardTitle>Order Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Customer</p>
                    <p className="text-lg font-medium">
                      {orderData?.client?.firstName} {orderData?.client?.lastName} —{" "}
                      {orderData?.client?.username} ({orderData?.client?.email})
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Order ID</p>
                    <p className="font-mono break-all">{orderData?.id ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Order&nbsp;number</p>
                    <p className="font-medium">{orderData?.orderKey ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Cart ID</p>
                    <p className="font-medium">{orderData?.cartId ?? "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ───────────────────────── ORDER NOTES ───────────────────────── */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquarePlus className="h-5 w-5" /> Order Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Button
                      variant={notesScope === "staff" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNotesScope("staff")}
                    >
                      Staff view
                    </Button>
                    <Button
                      variant={notesScope === "customer" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNotesScope("customer")}
                    >
                      Customer view
                    </Button>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Public notes are visible to the customer.
                  </div>
                </div>

                <div className="border rounded-lg">
                  <ScrollArea className="h-64">
                    <div className="p-3 space-y-3">
                      {notesLoading ? (
                        <div className="flex items-center justify-center py-8 text-muted-foreground">
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading notes…
                        </div>
                      ) : notes.length === 0 ? (
                        <div className="text-center text-muted-foreground py-8">
                          No notes yet.
                        </div>
                      ) : (
                        notes.map((n) => (
                          <div key={n.id} className="border rounded-md p-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge variant="secondary">
                                  {n.authorRole === "staff" ? "Staff" : "Client"}
                                </Badge>
                                <Badge className={n.visibleToCustomer ? "bg-green-600" : "bg-gray-500"}>
                                  {n.visibleToCustomer ? "Customer-visible" : "Staff-only"}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  size="icon" variant="ghost"
                                  onClick={() => toggleNoteVisibility(n.id, !n.visibleToCustomer)}
                                  title={n.visibleToCustomer ? "Make staff-only" : "Make public"}
                                >
                                  {n.visibleToCustomer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                                <Button size="icon" variant="ghost" onClick={() => deleteNote(n.id)} title="Delete">
                                  <Trash className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                            <p className="mt-2 text-sm whitespace-pre-wrap">{n.note}</p>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {new Date(n.createdAt).toLocaleString()}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </div>

                <div className="space-y-3">
                  <Textarea
                    value={newNote}
                    placeholder="Add a note for this order…"
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch id="public-note-edit" checked={newNotePublic} onCheckedChange={setNewNotePublic} />
                      <Label htmlFor="public-note-edit" className="text-sm">Visible to customer</Label>
                    </div>
                    <Button onClick={createNote} disabled={!newNote.trim() || !currentUserId || creatingNote}>
                      {creatingNote && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Add Note
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Product Selection (mirror Create page layout/UX) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" /> Product Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {orderItems.length > 0 && (
                  <div className="space-y-4 mb-4">
                    {orderItems.map(({ product, quantity }, idx) => {
                      const price = product.regularPrice?.[clientCountry] ?? product.price;

                      // For stock line we prefer product.stockData; if empty, hydrate from catalog
                      const pHydrate =
                          product.stockData && Object.keys(product.stockData).length
                            ? product
                            : (findProduct(product.id, product.variationId ?? null) ?? product);

                      const base = stockForCountry(pHydrate.stockData, clientCountry);
                      const used = inCartQty(product.id, orderItems, product.variationId ?? null);
                      const remaining = Math.max(0, base - used);
                      const finite = Object.keys(pHydrate.stockData || {}).length > 0;
                      const disablePlus = finite && !pHydrate.allowBackorders && remaining === 0;

                      return (
                        <div
                          key={`${product.id}:${product.variationId ?? 'null'}`}
                          className={
                            "flex items-center gap-4 p-4 border rounded-lg" +
                            (stockErrors[product.id] ? " border-red-500" : "")
                          }
                        >
                          {product.image ? (
                            <Image
                              src={product.image}
                              alt={product.title}
                              width={80}
                              height={80}
                              className="rounded-md"
                            />
                          ) : (
                            <div className="w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center text-gray-400">
                              No image
                            </div>
                          )}
                          <div className="flex-1">
                            <div className="flex justify-between">
                              <h3 className="font-medium">{product.title}</h3>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => removeProduct(product.id, product.variationId ?? null)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                            <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                            <div
                              className="text-sm"
                              dangerouslySetInnerHTML={{ __html: product.description }}
                            />

                             <div className="flex items-center gap-2 mt-2"> 
                              <Button variant="ghost" size="icon" onClick={() => updateQuantity(product.id, product.variationId ?? null, "subtract")}>
                                <Minus className="h-4 w-4" />
                              </Button>
                              <span className="font-medium">{quantity}</span>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => updateQuantity(product.id, product.variationId ?? null, "add")}
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
                                {formatCurrency(product.subtotal ?? price * quantity, clientCountry)}
                              </span>
                            </div>

                            {/* Stock (client country), decreased by qty already in cart */}
                            {Object.keys(pHydrate.stockData || {}).length > 0 && (
                              <div className="mt-1 text-xs text-muted-foreground">
                                Stock in {clientCountry || "country"}: {remaining}
                                {remaining === 0 && pHydrate.allowBackorders ? " (backorder allowed)" : ""}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Add product row (same UX as Create) */}
                <div className="flex flex-col sm:flex-row gap-4">
                  <div className="flex-1">
                    <Label>Select Product</Label>
                    <Select
                      value={selectedProduct}
                      onValueChange={(val) => {
                      const { id, variationId } = parseKey(val);
                      const obj = findProduct(id, variationId);
                        if (!obj) return;

                        const hasFiniteStock = Object.keys(obj.stockData || {}).length > 0;
                        const base = stockForCountry(obj.stockData, clientCountry);
                        const remaining = hasFiniteStock
                                          ? Math.max(0, base - inCartQty(obj.id, orderItems, obj.variationId ?? null))
                                          : Infinity;
                        if (hasFiniteStock && remaining === 0 && !obj.allowBackorders) {
                          toast.error("This product is out of stock for the selected country.");
                          return;
                        }
                        pickProduct(val, obj);
                      }}
                      disabled={productsLoading}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={productsLoading ? "Loading…" : "Select a product"} />
                      </SelectTrigger>

                      <SelectContent className="w-[500px]">
                        {/* — search bar — */}
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
                          {/* Local grouped (shop) */}
                          {groupByCategory(filteredProducts.filter((p) => !p.isAffiliate)).map(
                            ([label, items]) => (
                              <SelectGroup key={label}>
                                <SelectLabel>{label}</SelectLabel>
                                {items.map((p) => {
                                  const price = p.regularPrice?.[clientCountry] ?? p.price;
                                  const finite = Object.keys(p.stockData || {}).length > 0;
                                  const base = stockForCountry(p.stockData, clientCountry);
                                  const already = inCartQty(p.id, orderItems, p.variationId ?? null);
                                  const remaining = finite ? Math.max(0, base - already) : Infinity;
                                  const shouldDisable = finite ? remaining === 0 && !p.allowBackorders : false;

                                  return (
                                    <SelectItem key={keyFor(p)} value={keyFor(p)} disabled={shouldDisable}>
                                      <span className="block max-w-[420px] truncate">
                                        {p.title} — ${price}
                                        {finite && (
                                          <span className="ml-2 text-xs text-muted-foreground">
                                            Stock: {remaining}
                                            {remaining === 0 && p.allowBackorders ? " (backorder)" : ""}
                                            {shouldDisable ? " (out of stock)" : ""}
                                          </span>
                                        )}
                                      </span>
                                    </SelectItem>
                                  );
                                })}
                                <SelectSeparator />
                              </SelectGroup>
                            )
                          )}

                          {/* Local affiliate */}
                          {filteredProducts.some((p) => p.isAffiliate) && (
                            <SelectGroup>
                              <SelectLabel>Affiliate</SelectLabel>
                              {filteredProducts
                                .filter((p) => p.isAffiliate)
                                .map((p) => (
                                  <SelectItem key={keyFor(p)} value={keyFor(p)}>
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
                                // Exclude remote items that already exist locally, by key
                                prodResults.filter(
                                  (p) => !p.isAffiliate && !products.some((lp) => keyFor(lp) === keyFor(p))
                                )
                              ).map(([label, items]) => (
                                <SelectGroup key={`remote-${label}`}>
                                  <SelectLabel>{label} — search</SelectLabel>
                                  {items.map((p) => {
                                    const price = p.regularPrice?.[clientCountry] ?? p.price;
                                    const finite = Object.keys(p.stockData || {}).length > 0;
                                    const base = stockForCountry(p.stockData, clientCountry);
                                    const already = inCartQty(p.id, orderItems, p.variationId ?? null);
                                    const remaining = finite ? Math.max(0, base - already) : Infinity;
                                    const shouldDisable = finite ? remaining === 0 && !p.allowBackorders : false;
                                    return (
                                      <SelectItem key={keyFor(p)} value={keyFor(p)} disabled={shouldDisable}>
                                        <span className="block max-w-[420px] truncate">
                                          {p.title} — ${price}
                                          <span className="ml-2 text-xs text-muted-foreground">
                                            {finite ? (
                                              <>
                                                Stock: {remaining}
                                                {remaining === 0 && p.allowBackorders ? " (backorder)" : ""}
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

                              {prodResults.some(
                                (p) => p.isAffiliate && !products.some((lp) => keyFor(lp) === keyFor(p))
                              ) && (
                                  <SelectGroup>
                                    <SelectLabel>Affiliate — search</SelectLabel>
                                    {prodResults
                                      .filter((p) => p.isAffiliate && !products.some((lp) => lp.id === p.id))
                                      .map((p) => (
                                        <SelectItem key={keyFor(p)} value={keyFor(p)}>
                                          {p.title} — {p.price} pts
                                          <span className="ml-1 text-xs text-muted-foreground">(remote)</span>
                                        </SelectItem>
                                      ))}
                                  </SelectGroup>
                                )}
                            </>
                          )}

                          {prodSearching && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
                          )}
                          {!prodSearching && prodTerm && prodResults.length === 0 && (
                            <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
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

            {/* Discount Coupon (same component layout) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Tag className="h-5 w-5" /> Discount Coupon
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex justify-between items-center">
                  <p className="text-lg font-medium">
                    {newCoupon ? newCoupon : orderData?.coupon || "—"}
                  </p>
                  <div className="flex items-center gap-2">
                    <Label htmlFor="newCouponSwitch" className="text-sm">
                      New coupon?
                    </Label>
                    <Switch
                      id="newCouponSwitch"
                      checked={showNewCoupon}
                      onCheckedChange={setShowNewCoupon}
                    />
                  </div>
                </div>

                {showNewCoupon && (
                  <>
                    <Separator />
                    <div className="flex gap-4 flex-wrap">
                      <Input
                        className="flex-1 min-w-[200px]"
                        placeholder="Enter coupon code"
                        disabled={couponApplied}
                        value={newCoupon}
                        onChange={(e) => setNewCoupon(e.target.value)}
                      />
                      <Button
                        disabled={!newCoupon || couponApplied}
                        onClick={handleApplyCoupon}
                      >
                        Apply Coupon
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Shipping Address (same layout) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" /> Shipping Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {addresses.map((addr) => (
                    <label key={addr.id} className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="address"
                        value={addr.id}
                        checked={selectedAddressId === addr.id}
                        onChange={() => setSelectedAddressId(addr.id)}
                        className="h-4 w-4"
                      />
                      <span className="text-sm whitespace-pre-line break-words">{addr.address}</span>
                    </label>
                  ))}
                </div>
                <Separator className="my-3" />
                <div className="flex gap-4">
                  <Textarea
                    className="flex-1 min-h-[140px] whitespace-pre-line"
                    placeholder="New address (multi-line)"
                    value={newAddress}
                    onChange={(e) => setNewAddress(e.target.value)}
                  />
                  <Button onClick={handleAddAddress} disabled={!newAddress}>
                    Add Address
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Shipping Method & Company (same layout) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" /> Shipping
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Method */}
                  <div>
                    <Label>Method</Label>
                    <Select
                      value={selectedShippingMethod}
                      onValueChange={setSelectedShippingMethod}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={shippingLoading ? "Loading…" : "Select method"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {shippingMethods.map((m) => {
                          const tier = m.costs.find(
                            ({ minOrderCost, maxOrderCost }) =>
                              total >= minOrderCost &&
                              (maxOrderCost === 0 || total <= maxOrderCost)
                          );
                          const cost = tier ? tier.shipmentCost : 0;

                          return (
                            <SelectItem key={m.id} value={m.id}>
                              <span className="block max-w-[280px] truncate">
                                {m.title} — {m.description} — ${cost.toFixed(2)}
                              </span>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  {/* Company */}
                  <div>
                    <Label>Company</Label>
                    <Select
                      value={selectedShippingCompany}
                      onValueChange={setSelectedShippingCompany}
                    >
                      <SelectTrigger>
                        <SelectValue
                          placeholder={shippingLoading ? "Loading…" : "Select company"}
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {shippingCompanies.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Method (same layout) */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" /> Payment Method
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Label>Select Payment Method</Label>
                <Select
                  value={selectedPaymentMethod}
                  onValueChange={setSelectedPaymentMethod}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select payment method" />
                  </SelectTrigger>
                  <SelectContent>
                    {paymentMethods.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Niftipay chain / asset selector */}
                {paymentMethods.find(
                  (p) =>
                    p.id === selectedPaymentMethod &&
                    p.name.toLowerCase() === "niftipay"
                ) && (
                    <div className="mt-4">
                      <Label>Select Crypto Network</Label>
                      <Select
                        value={selectedNiftipay}
                        onValueChange={setSelectedNiftipay}
                        disabled={niftipayLoading}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={niftipayLoading ? "Loading…" : "Select network"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {niftipayNetworks.map((n) => (
                            <SelectItem key={`${n.chain}:${n.asset}`} value={`${n.chain}:${n.asset}`}>
                              {n.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
              </CardContent>
            </Card>
          </div>

          {/* RIGHT COLUMN: Order Summary */}
          <div className="lg:col-span-1">
            <Card className="sticky top-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" /> Order Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Client:</span>
                    <span className="font-medium">{orderData?.clientEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Items:</span>
                    <span className="font-medium">
                      {orderItems.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-medium">{formatCurrency(subtotal, clientCountry)}</span>
                  </div>

                  {orderData?.pointsRedeemed > 0 && (
                    <div className="flex justify-between text-blue-600">
                      <span>Points Redeemed:</span>
                      <span className="font-medium">
                        {orderData.pointsRedeemed} pts
                      </span>
                    </div>
                  )}

                  {orderData?.pointsRedeemedAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Points Discount:</span>
                      <span className="font-medium">
                        -{formatCurrency(orderData.pointsRedeemedAmount, clientCountry)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-green-600">
                    <span>
                      Discount
                      {discountType === "percentage" ? ` (${value.toFixed(2)}%)` : ""}:
                    </span>
                    <span className="font-medium">–{formatCurrency(discount, clientCountry)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shipping:</span>
                    <span className="font-medium">
                      {orderData?.shipping != null
                        ? formatCurrency(orderData.shipping, clientCountry)
                        : "—"}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span>{formatCurrency(total, clientCountry)}</span>
                  </div>
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button className="w-full" onClick={handleUpdateOrder}>
                  Update Order
                </Button>
              </CardFooter>
            </Card>
          </div>
        </div>
      </div>
    );
  }
