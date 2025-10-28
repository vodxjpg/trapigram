// src/app/(dashboard)/orders/[id]/edit/orderForm.tsx
"use client";

import React, { useState, useEffect, useMemo, useCallback } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tag } from "lucide-react";
import { toast } from "sonner";
import { Package } from "lucide-react";

import ProductSelect from "../../../../../components/products/product-select";
import DiscountCoupon from "../../components/discount-coupon";
import ShippingAddress from "../../components/shipping-address";
import ShippingOptions from "../../components/shipping-options";
import PaymentMethod from "../../components/payment-method";
import OrderSummary from "../../components/order-summary";
import OrderNotes from "../../components/order-notes";

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
  const { data: session } = authClient.useSession();
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

  // Adapt parent's "id::variation" <-> child "id:variation|base"
  function toChildToken(parentToken: string): string {
    if (!parentToken) return "";
    const [id, v = ""] = parentToken.split("::");
    return `${id}:${v ? v : "base"}`;
  }
  function fromChildToken(childToken: string): string {
    if (!childToken) return "";
    const [id, v = "base"] = childToken.split(":");
    return `${id}::${v === "base" ? "" : v}`;
  }


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

  // ⬇️ NEW: hydrate from orderData once it’s fetched
  useEffect(() => {
    if (!orderData) return;

    const hasCoupon = Boolean(orderData.coupon);
    setCouponApplied(hasCoupon);
    setCouponCode(orderData.coupon || "");
    setNewCoupon(""); // input starts empty for “apply new”

    setDiscount(Number(orderData.discount ?? 0));
    setValue(Number(orderData.discountValue ?? 0));
    setDiscountType(
      String(orderData.couponType || "").toLowerCase() === "percentage"
        ? "percentage"
        : "fixed"
    );
    if (typeof orderData.subtotal === "number") {
      setSubtotal(orderData.subtotal);
    }
  }, [orderData]);


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

  // Child calls pickProduct(tokenOf(id:variation|base), obj)
  const pickProductForChild = (childToken: string, obj: Product) => {
    // Convert to parent's selectedProduct format and reuse your existing pickProduct behavior
    const parentToken = fromChildToken(childToken);
    pickProduct(parentToken, obj); // your existing pickProduct
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
  const handleApplyCoupon = useCallback(async () => {
    if (!newCoupon || !orderData?.cartId || !orderData?.id) return;
    try {
      const patchRes = await fetch(`/api/cart/${orderData.cartId}/apply-coupon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: newCoupon, total: subtotal }),
      });
      if (!patchRes.ok) throw new Error("Failed to apply coupon");
      const data = await patchRes.json();
      const { discountAmount: amt, discountType: dt, discountValue: dv, cc } = data;

      if (cc === null) {
        // remove coupon UI state
        setCouponCode("");
        setCouponApplied(false);
        toast.error("Coupon can't be applied!");
      } else {
        // update state to the newly applied coupon
        setDiscount(Number(amt || 0));
        setValue(Number(dv || 0));
        setDiscountType(String(dt || "").toLowerCase() === "percentage" ? "percentage" : "fixed");
        setCouponApplied(true);
        setCouponCode(newCoupon);
        toast.success("Coupon applied!");
      }
      // keep input
      setNewCoupon(newCoupon);
      setShowNewCoupon(true);
    } catch (err) {
      console.error(err);
      toast.error("Failed to apply coupon");
    }
  }, [newCoupon, orderData?.cartId, orderData?.id, subtotal]);

  // ─────────────────────────────────────────────
  // NEW: derived breakdown for the shared component
  // ─────────────────────────────────────────────
  const couponBreakdown = useMemo(() => {
    if (!couponApplied) return [];
    const code =
      couponCode && couponCode.trim().length > 0 ? couponCode : newCoupon;
    const after = Math.max(0, subtotal - discount);
    return [
      {
        code,
        discountType,
        discountValue: value,
        discountAmount: discount,
        subtotalAfter: after,
      },
    ];
  }, [couponApplied, couponCode, newCoupon, discountType, value, discount, subtotal]);

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

  // Child passes (productId, variationId, idx) for remove; parent ignores idx
  const removeProductForChild = (productId: string, variationId: string | null /*, idx: number */) => {
    return removeProduct(productId, variationId); // your existing removeProduct signature
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

          {/* Product Selection (mirror Create page layout/UX) */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Product Selection
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <ProductSelect
                // Gate: in the edit page, the order already exists → selector enabled
                orderGenerated={true}

                // Current cart lines and context
                orderItems={orderItems}
                clientCountry={clientCountry}
                stockErrors={stockErrors}

                // Handlers (removeProduct expects an idx in child; we adapt above)
                removeProduct={removeProductForChild}
                updateQuantity={updateQuantity}
                addProduct={addProduct}

                // Product picker state (unchanged)
                productsLoading={productsLoading}
                // Convert parent token ("id::variation") to child's token ("id:variation|base")
                selectedProduct={toChildToken(selectedProduct)}
                prodTerm={prodTerm}
                setProdTerm={setProdTerm}
                filteredProducts={filteredProducts}
                prodResults={prodResults}
                prodSearching={prodSearching}
                products={products}

                // Helpers
                pickProduct={pickProductForChild}
                groupByCategory={groupByCategory}

                // Quantity input state (unchanged)
                quantityText={quantityText}
                setQuantityText={setQuantityText}
                parseQty={parseQty}
              />
            </CardContent>
          </Card>

          {/* Coupon header (no Card). Shows current code and toggle to apply a new one */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tag className="h-5 w-5" />
              <span className="text-sm font-medium">Coupon apply:</span>
              <span className="text-sm text-muted-foreground">
                {newCoupon?.trim() ? newCoupon : (orderData?.coupon?.trim() || "—")}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Label htmlFor="newCouponSwitch" className="text-sm">Apply new code?</Label>
              <Switch
                id="newCouponSwitch"
                checked={showNewCoupon}
                onCheckedChange={setShowNewCoupon}
              />
            </div>
          </div>

          {showNewCoupon && (
            <DiscountCoupon
              orderGenerated={true}
              appliedCodes={
                couponApplied
                  ? [(couponCode?.trim() || orderData?.coupon?.trim() || "").trim()]
                    .filter(Boolean) as string[]
                  : []
              }
              discountTotal={discount}
              clientCountry={clientCountry}
              couponCode={newCoupon}
              setCouponCode={setNewCoupon}
              couponBreakdown={
                couponApplied
                  ? [{
                    code: (couponCode?.trim() || orderData?.coupon?.trim() || "").trim(),
                    discountType,
                    discountValue: value,
                    discountAmount: discount,
                    subtotalAfter: Math.max(0, Number(subtotal) - Number(discount)),
                  }]
                  : []
              }
              applyCoupon={handleApplyCoupon}
            />
          )}

          {/* Shipping Address (same layout) */}
          <ShippingAddress
            orderGenerated={true}
            addresses={addresses}
            selectedAddressId={selectedAddressId}
            setSelectedAddressId={setSelectedAddressId}
            newAddress={newAddress}
            setNewAddress={setNewAddress}
            addAddress={handleAddAddress}
          />

          {/* Shipping Method & Company (same layout) */}
          <ShippingOptions
            orderGenerated={true}
            shippingLoading={shippingLoading}
            shippingMethods={shippingMethods}
            selectedShippingMethod={selectedShippingMethod}
            setSelectedShippingMethod={setSelectedShippingMethod}
            shippingCompanies={shippingCompanies}
            selectedShippingCompany={selectedShippingCompany}
            setSelectedShippingCompany={setSelectedShippingCompany}
            /* matches your previous tier selection, which used "total".
               The component expects the order value BEFORE shipping: subtotal - discount */
            totalBeforeShipping={Math.max(0, (subtotal ?? 0) - (discount ?? 0))}
          />

          {/* Payment Method (same layout) */}
          <PaymentMethod
            orderGenerated={true}
            paymentMethods={paymentMethods}
            selectedPaymentMethod={selectedPaymentMethod}
            setSelectedPaymentMethod={setSelectedPaymentMethod}
            /* Niftipay selector (shown when the chosen PM is 'niftipay') */
            niftipayNetworks={niftipayNetworks}
            selectedNiftipay={selectedNiftipay}
            setSelectedNiftipay={setSelectedNiftipay}
          />
        </div>

        {/* RIGHT COLUMN: Order Summary */}
        <div className="lg:col-span-1 lg:sticky lg:top-6 self-start">
          <div className="space-y-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-1">
            <OrderSummary
              orderGenerated={true}
              clientEmail={orderData?.clientEmail ?? ""}
              itemsCount={orderItems.reduce((sum, item) => sum + item.quantity, 0)}
              itemsSubtotal={subtotal}
              discountTotal={discount}
              shippingCost={orderData?.shipping ?? 0}
              total={total}
              clientCountry={clientCountry}
              onCreateOrder={handleUpdateOrder}
              createDisabled={!orderData}
              create={false}
            />

            {/* Moved here: Order Notes (as a component below Order Summary) */}
            <OrderNotes
              notesScope={notesScope}
              setNotesScope={setNotesScope}
              notesLoading={notesLoading}
              notes={notes}
              newNote={newNote}
              setNewNote={setNewNote}
              newNotePublic={newNotePublic}
              setNewNotePublic={setNewNotePublic}
              creatingNote={creatingNote}
              createNote={createNote}
              toggleNoteVisibility={toggleNoteVisibility}
              deleteNote={deleteNote}
            />
          </div>
        </div>
      </div>
    </div >
  );
}
