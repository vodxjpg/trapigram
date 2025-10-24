// order-form.tsx
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

import { toast } from "sonner";

import ClientSelect from "../components/client-select";
import ProductSelect from "../components/product-select";
import DiscountCoupon from "../components/discount-coupon";
import ShippingAddress from "../components/shipping-address";
import ShippingOptions from "../components/shipping-options";
import PaymentMethod from "../components/payment-method";
import OrderSummary from "../components/order-summary"; // ← NEW

/* ─── constants ──────────────────────────────────────────────── */
// If the env-var is set use it, otherwise fall back to the public endpoint.
const NIFTIPAY_BASE = (process.env.NEXT_PUBLIC_NIFTIPAY_API_URL || "https://www.niftipay.com").replace(
  /\/+$/,
  ""
);

type NiftipayNet = { chain: string; asset: string; label: string };

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

// Give every row (product or variation) a unique token for the <Select>
const tokenOf = (p: Product) => `${p.id}:${p.variationId ?? "base"}`;
const parseToken = (t: string) => {
  const [productId, v] = String(t).split(":");
  return { productId, variationId: v === "base" ? null : v };
};
// Interfaces
interface Product {
  id: string;                 // productId
  variationId?: string | null; // ← add this
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

interface OrderItem {
  product: Product;
  quantity: number;
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
interface Address {
  id: string;
  clientId: string;
  address: string;
}
// add `active` so we can label it in the UI
interface PaymentMethod {
  id: string;
  name: string;
  active?: boolean; // <-- new
  details?: string;
  apiKey?: string | null;
}


/* ─── friendly error helper ───────────────────────────────────────────── */
// Map common backend messages → clearer toasts for the user.
function showFriendlyCreateOrderError(raw?: string | null): boolean {
  const msg = (raw || "").toLowerCase();

  // Shipping
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
  // Niftipay
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


/* ─── helpers (new) ───────────────────────────────────────────── */

/* ─── currency map helpers ─────────────────────────────────────── */
const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
]);

function countryToFiat(c: string): string {
  const code = c.toUpperCase();
  if (code === "GB") return "GBP";
  if (EU_COUNTRIES.has(code)) return "EUR";
  return "USD";
}

function fmt(n: number | string): string {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

function firstPointPrice(pp: any): number {
  if (!pp) return 0;
  const firstLvl = (Object.values(pp)[0] as any) ?? {};
  const firstCtMap = (Object.values(firstLvl)[0] as any) ?? {};
  return firstCtMap.sale ?? firstCtMap.regular ?? 0;
}

// Sum stock across all warehouses for a specific country
const stockForCountry = (p: Product, country: string): number =>
  Object.values(p.stockData || {}).reduce(
    (sum, wh) => sum + (wh?.[country] ?? 0),
    0
  );

// Quantity currently in cart for a given product
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


const DEBOUNCE_MS = 400;
export default function OrderForm() {
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  // States

  const [clients, setClients] = useState<any[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState("");
  const [clientCountry, setClientCountry] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setResults] = useState<any[]>([]);

  const categoryLabel = (id?: string) =>
    id ? (categoryMap[id] || id) : "Uncategorized";

  const groupByCategory = (arr: Product[]) => {
    const buckets: Record<string, Product[]> = {};
    for (const p of arr) {
      if (p.isAffiliate) continue; // handled in its own section
      const firstCat = p.categories?.[0];
      const label = categoryLabel(firstCat);
      if (!buckets[label]) buckets[label] = [];
      buckets[label].push(p);
    }
    // Optional: sort buckets & items
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => [label, items.sort((x, y) => x.title.localeCompare(y.title))] as const);
  };


  /* keep a memoised local filter so we see matches immediately while typing */
  const filteredClients = useMemo(() => {
    if (searchTerm.trim().length < 3) return clients;
    const t = searchTerm.toLowerCase();
    return clients.filter(
      (c) =>
        c.username?.toLowerCase().includes(t) ||
        c.email?.toLowerCase().includes(t) ||
        `${c.firstName} ${c.lastName}`.toLowerCase().includes(t)
    );
  }, [clients, searchTerm]);

  /* ────────────────────────────────────────────────────────────────
     Remote search (debounced)
     – runs only when the user typed ≥3 chars
     – hits GET /api/clients?search=…&pageSize=10
  ───────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const q = searchTerm.trim();
    if (q.length < 3) {
      // short query → reset
      setResults([]);
      setSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const url = `/api/clients?search=${encodeURIComponent(q)}&page=1&pageSize=10`;
        const res = await fetch(url, {
          headers: {
            "x-internal-secret": process.env.INTERNAL_API_SECRET!,
          },
        });
        if (!res.ok) throw new Error("Search failed");
        const { clients: found } = await res.json();
        setResults(found);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS); // 400 ms debounce

    return () => clearTimeout(timer); // cleanup on next keystroke/unmount
  }, [searchTerm]);

  const [orderGenerated, setOrderGenerated] = useState(false);

  const [cartId, setCartId] = useState("");
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [shippingLoading, setShippingLoading] = useState(true);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>(
    []
  );

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  // Category label cache: { [id]: name }
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});

  // Load ALL categories → build {id → name} map (no pagination gaps).
  useEffect(() => {
    (async () => {
      try {
        // Preferred: server supports ?all=1
        const res = await fetch("/api/product-categories?all=1").catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const rows: Array<{ id: string; name: string }> =
            data.categories ?? data.items ?? [];
          setCategoryMap(Object.fromEntries(rows.map((c) => [c.id, c.name])));
          return;
        }

        // Fallback: client-side pagination loop
        let page = 1;
        const pageSize = 200;
        const acc: Array<{ id: string; name: string }> = [];
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const r = await fetch(
            `/api/product-categories?page=${page}&pageSize=${pageSize}`
          ).catch(() => null);
          if (!r || !r.ok) break;
          const data = await r.json().catch(() => ({}));
          const rows = Array.isArray(data.categories) ? data.categories : [];
          acc.push(
            ...rows.map((c: any) => ({ id: c.id, name: c.name }))
          );
          const totalPages = Number(data.totalPages || 1);
          if (page >= totalPages) break;
          page += 1;
        }
        if (acc.length) {
          setCategoryMap(Object.fromEntries(acc.map((c) => [c.id, c.name])));
        }
      } catch {
        // noop – we’ll fall back to showing raw IDs if needed
      }
    })();
  }, []);


  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});
  // keep text while typing; coerce on blur/use
  const [quantityText, setQuantityText] = useState("1");
  const parseQty = (s: string) => {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n > 0 ? n : 1;
  };
  const [productsLoading, setProductsLoading] = useState(true);

  const [couponCode, setCouponCode] = useState("");

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState("");

  // NEW state for stacked coupons
  const [appliedCodes, setAppliedCodes] = useState<string[]>([]);
  const [discountTotal, setDiscountTotal] = useState(0); // cumulative discount €
  const [couponBreakdown, setCouponBreakdown] = useState<
    {
      code: string;
      discountType: "percentage" | "fixed";
      discountValue: number;
      discountAmount: number;
      subtotalAfter: number;
    }[]
  >([]);
  const [couponTypeByCode, setCouponTypeByCode] = useState<
    Record<string, string>
  >({});
  const [couponValues, setCouponValues] = useState<number[]>([]);

  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  /* ▼ Niftipay UI state */
  const [niftipayNetworks, setNiftipayNetworks] = useState<
    { chain: string; asset: string; label: string }[]
  >([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);
  const [selectedNiftipay, setSelectedNiftipay] = useState(""); // "chain:asset"

  const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
  const [selectedShippingMethod, setSelectedShippingMethod] = useState("");
  const [shippingCost, setShippingCost] = useState(0);

  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");

  const [itemsSubtotal, setItemsSubtotal] = useState(0);

  const calcRowSubtotal = (p: Product, qty: number) => p.price * qty;

  /*───────────────────────────────────────────────────────────────
  When the user chooses a row (local or remote) we:  
    1. set it as the selected client  
    2. cache remote results so the rest of the form works normally  
    3. reset the search UI                                               
─────────────────────────────────────────────────────────────────*/
  const pickClient = (id: string, obj: any) => {
    setSelectedClient(id);
    if (!clients.some((c) => c.id === id)) {
      setClients((prev) => [...prev, obj]);
    }
    setSearchTerm("");
    setResults([]);
  };

  // Added useEffect to recalculate subtotal whenever orderItems change
  useEffect(() => {
    const sum = orderItems.reduce(
      (acc, item) =>
        acc + (item.product.subtotal ?? item.product.price * item.quantity),
      0
    );
    setItemsSubtotal(sum);
  }, [orderItems]);

  useEffect(() => {
    loadClients();
    loadProducts();
  }, []);

  async function loadClients() {
    setClientsLoading(true);
    try {
      const res = await fetch("/api/clients", {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
      });
      const { clients } = await res.json();
      setClients(clients);
    } catch {
      toast.error("Failed loading clients");
    } finally {
      setClientsLoading(false);
    }
  }

  const generateOrder = async () => {
    if (!selectedClient) return;
    // we already know the client – grab its country once
    const clientInfo = clients.find((c) => c.id === selectedClient);
    try {
      const resC = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: selectedClient,
          country: clientInfo?.country || "", // ← rename
        }),
      });
      if (!resC.ok) throw new Error("Failed to create cart.");
      const dataC = await resC.json();
      const { newCart } = dataC;
      setCartId(newCart.id);
      const resP = await fetch(`/api/cart/${newCart.id}`, {
        headers: { "Content-Type": "application/json" },
      });
      const dataP = await resP.json();
      const { resultCartProducts } = dataP;
      if (Array.isArray(resultCartProducts)) {
        setOrderItems(
          resultCartProducts.map((r: any) => {
            const pMatch =
              products.find((p) => p.id === r.id && (p.variationId ?? null) === (r.variationId ?? null)) ??
              products.find((p) => p.id === r.id);

            return {
              product: {
                id: r.id,
                variationId: r.variationId ?? null,

                // ✅ keep label with attribute/term
                title: pMatch?.title ?? r.title,

                // ✅ keep the VARIANT sku if you have it from the list API
                sku: pMatch?.sku ?? r.sku,

                description: r.description,
                image: pMatch?.image ?? r.image,
                price: r.unitPrice,
                regularPrice: pMatch?.regularPrice ?? {},
                stockData: pMatch?.stockData ?? {},
                allowBackorders: pMatch?.allowBackorders,
                subtotal: r.subtotal,
              },
              quantity: r.quantity,
            };

          })
        );
      }

      const subtotal = resultCartProducts.reduce((accumulator, current) => {
        return accumulator + current.subtotal;
      }, 0);

      setItemsSubtotal(subtotal);

      if (clientInfo) setClientCountry(clientInfo.country); // reuse
      setShippingLoading(true);
      try {
        const shipRes = await fetch("/api/shipments", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        if (!shipRes.ok) throw new Error("Failed to fetch shipping methods");
        const methods: { shipments: ShippingMethod[] } = await shipRes.json();
        setShippingMethods(methods.shipments);
        // If none available, guide the user proactively
        if (!methods.shipments?.length) {
          toast.error("You need to create a shipping method first");
        }

        const compRes = await fetch("/api/shipping-companies", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        if (!compRes.ok) throw new Error("Failed to fetch shipping companies");
        const comps: any = await res.json();
        // Some backends use {shippingMethods:[...]} for companies (legacy). Support both.
        const companies: ShippingCompany[] =
          comps?.companies ?? comps?.shippingMethods ?? [];
        setShippingCompanies(companies);
        if (!companies.length) {
          toast.error("You need to set up a shipping company first");
        }
      } catch (err: any) {
        if (!showFriendlyCreateOrderError(err?.message)) {
          toast.error(err?.message || "Failed to load shipping/payout methods");
        }
      } finally {
        setShippingLoading(false);
      }

      toast.success("Cart created!");
      setOrderGenerated(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Sum stock across all warehouses for a specific country code
  const stockForCountryLocal = (p: Product, country: string): number =>
    Object.values(p.stockData || {}).reduce(
      (sum, wh) => sum + (wh?.[country] ?? 0),
      0
    );

  async function loadProducts() {
    setProductsLoading(true);
    try {
      // fetch BOTH normal and affiliate catalogues in parallel
      const [normRes, affRes] = await Promise.all([
        fetch("/api/products?page=1&pageSize=1000"),
        fetch("/api/affiliate/products?limit=1000"),
      ]);
      if (!normRes.ok || !affRes.ok) {
        throw new Error("Failed to fetch product lists");
      }

      const { productsFlat: norm } = await normRes.json(); // regular shop products
      const { products: aff } = await affRes.json(); // affiliate catalogue

      /* ---------- map everything into one uniform <Product> shape ---------- */

      const all: Product[] = [
        // 1) normal products
        ...norm.map((p: any) => ({
          id: p.id,
          variationId: p.variationId ?? null,     // ← keep it
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

        // 2) affiliate products
        ...aff.map((a: any) => {
          const firstPts = firstPointPrice(a.pointsPrice);

          const regularPrice: Record<string, number> = {
            // keep it simple
            pts: firstPts,
          };

          return {
            id: a.id,
            title: a.title,
            sku: a.sku,
            description: a.description,
            image: a.image,
            regularPrice,
            price: firstPts,
            stockData: a.stock ?? {}, // often empty → unlimited
            isAffiliate: true,
            subtotal: 0,
            categories: [],
          };
        }),
      ];
      setProducts(all);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "Failed loading products");
    } finally {
      setProductsLoading(false);
    }
  }

  const countryProducts = products.filter((p) => {
    // if it’s an affiliate product, show it un-conditionally
    if (!Object.keys(p.stockData).length) return true;

    // otherwise require stock in the client’s country
    const totalStock = Object.values(p.stockData).reduce(
      (sum, e) => sum + (e[clientCountry] || 0),
      0
    );
    if (totalStock > 0) return true;

    // …or allow it when backorders are enabled
    return p.allowBackorders === true;
  });

  const [prodTerm, setProdTerm] = useState("");
  const [prodSearching, setProdSearching] = useState(false);
  const [prodResults, setProdResults] = useState<Product[]>([]);
  /* fast local filter so the list reacts as you type */
  const filteredProducts = useMemo(() => {
    if (prodTerm.trim().length < 3) return countryProducts;
    const q = prodTerm.toLowerCase();
    return countryProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)
    );
  }, [countryProducts, prodTerm]);

  /* pick a product (works for both local + remote) */
  const pickProduct = (token: string, obj: Product) => {
    setSelectedProduct(token);
    if (!products.some((p) => tokenOf(p) === token))
      setProducts((prev) => [...prev, obj]);
    setProdTerm("");
    setProdResults([]);
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

        /* shop products */
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

        /* map ➜ our <Product> shape, tagging affiliates */
        // inside the prodTerm search effect
        const mapShop = (p: any): Product => ({
          ...p,
          variationId: p.variationId ?? null,   // ← add
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

  const loadAddresses = useCallback(async () => {
    if (!selectedClient) return;

    try {
      const res = await fetch(`/api/clients/${selectedClient}/address`, {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
      });

      if (!res.ok) throw new Error("Addresses load failed");

      const data = await res.json();
      const addrs: Address[] = data.addresses || [];

      setAddresses(addrs);

      // If nothing selected yet, pick the first one (if any)
      if (addrs.length && !selectedAddressId) {
        setSelectedAddressId(addrs[0].id);
      }
    } catch (e) {
      console.error(e);
      toast.error("Addresses load error");
      setAddresses([]);
    }
  }, [selectedClient, selectedAddressId]);

  useEffect(() => {
    if (!selectedClient) return;
    const loadAddresses = async (clientIdArg?: string) => {
      const cid = clientIdArg ?? selectedClient;
      if (!cid) return;
      try {
        const res = await fetch(`/api/clients/${cid}/address`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        const data = await res.json();

        setAddresses(data.addresses || []);

        // keep selected address if it still exists, otherwise pick the first (newest)
        setSelectedAddressId((prev) =>
          prev && (data.addresses || []).some((a: any) => a.id === prev)
            ? prev
            : (data.addresses?.[0]?.id ?? "")
        );
      } catch {
        toast.error("Addresses load error");
      }
    };

    const loadPayments = async () => {
      setPaymentLoading(true);
      try {
        const res = await fetch("/api/payment-methods", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        const data = await res.json();
        setPaymentMethods(data.methods);
        if (!Array.isArray(data.methods) || data.methods.length === 0) {
          // Proactive guidance when tenant has nothing configured
          toast.error("You need to set up a payment method first");
        }
      } catch (e) {
        toast.error("Payments load error");
      } finally {
        setPaymentLoading(false);
      }
    };

    const loadShipping = async () => {
      setShippingLoading(true);
      try {
        const [shipRes, compRes] = await Promise.all([
          fetch("/api/shipments", {
            headers: {
              "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
            },
          }),
          fetch("/api/shipping-companies", {
            headers: {
              "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
            },
          }),
        ]);
        const shipData = await shipRes.json();
        const compData = await compRes.json();
        setShippingMethods(shipData.shipments);
        {
          const companies: ShippingCompany[] =
            compData?.companies ?? compData?.shippingMethods ?? [];
          setShippingCompanies(companies);
          if (!companies.length) {
            toast.error("You need to set up a shipping company first");
          }
        }
        if (!shipData?.shipments?.length) {
          toast.error("You need to create a shipping method first");
        }
      } catch (e) {
        toast.error("Shipping load error");
      } finally {
        setShippingLoading(false);
      }
    };

    loadAddresses();
    loadPayments();
    loadShipping();

    // set country from client list
    const client = clients.find((c) => c.id === selectedClient);
    if (client) setClientCountry(client.country);
  }, [selectedClient]);

  /* ─── Niftipay network fetch whenever the PM select changes ───── */
  useEffect(() => {
    const pm = paymentMethods.find((p) => p.id === selectedPaymentMethod);
    // 🔧 also bail if Niftipay is inactive / misconfigured
    if (
      !pm ||
      !/niftipay/i.test(pm.name || "") ||
      pm.active === false
    ) {
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

  // 🔧 Smart default selection – prefer active, non-Niftipay methods
  useEffect(() => {
    if (selectedPaymentMethod) return;
    const active = paymentMethods.filter((m) => m.active !== false);
    const nonNifti = active.find((m) => !/niftipay/i.test(m.name || ""));
    const pick = nonNifti ?? active[0] ?? paymentMethods[0];
    if (pick) setSelectedPaymentMethod(pick.id);
  }, [paymentMethods, selectedPaymentMethod]);

  // — Add product
  // — Add product  (CREATE form)
  const addProduct = async () => {
    if (!selectedProduct || !cartId) return toast.error("Cart hasn’t been created yet!");

    const product = [...products, ...prodResults].find((p) => tokenOf(p) === selectedProduct);
    if (!product) return;

    const hasFiniteStock = Object.keys(product.stockData || {}).length > 0;
    const remaining = hasFiniteStock
      ? Math.max(
        0,
        stockForCountryLocal(product, clientCountry) -
        inCartQty(product.id, product.variationId ?? null, orderItems)
      )
      : Infinity;

    const qty = parseQty(quantityText);
    if (hasFiniteStock && !product.allowBackorders && (remaining === 0 || qty > remaining)) {
      toast.error(remaining === 0 ? "Out of stock" : `Only ${remaining} available`);
      return;
    }

    const unitPrice = product.regularPrice[clientCountry] ?? product.price;
    const { productId, variationId } = parseToken(selectedProduct);

    try {
      const qty = parseQty(quantityText);
      console.log(productId,
        variationId,
        qty,
        unitPrice,
        clientCountry,)
      const res = await fetch(`/api/cart/${cartId}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          variationId,
          quantity: qty,
          unitPrice,
          country: clientCountry,
        }),
      });

      /* ▼▼ ——— patch starts here ——— ▼▼ */
      if (!res.ok) {
        // consume JSON safely; fall back to empty object on parse error
        const body = await res.json().catch(() => ({}));
        const msg =
          (body.error as string) ??
          (body.message as string) ??
          "Failed to add product";
        throw new Error(msg); // the toast handler below will show it
      }
      /* ▲▲ ——— patch ends here ——— ▲▲ */

      const { product: added, quantity: qtyResp } = await res.json();
      const chosen =
        products.find(
          (p) =>
            p.id === added.id &&
            (p.variationId ?? null) === (added.variationId ?? variationId ?? null)
        ) ?? products.find((p) => p.id === added.id);

      const withStock: Product = {
        ...added,
        variationId: added.variationId ?? variationId ?? product.variationId ?? null,

        // ✅ keep the variant label you show in the list (often “Name – Attr: Term”)
        title: chosen?.title ?? product.title ?? added.title,

        // ✅ keep the VARIANT SKU (fallback to what API returned)
        sku: chosen?.sku ?? product.sku ?? added.sku,

        // (optional but nice) also prefer the image from the list row if set
        image: chosen?.image ?? added.image,

        regularPrice: added.regularPrice ?? chosen?.regularPrice ?? {},
        stockData: chosen?.stockData ?? added.stockData ?? {},
        allowBackorders: chosen?.allowBackorders ?? added.allowBackorders,
      };
      const subtotalRow = calcRowSubtotal(withStock, qtyResp);

      setOrderItems(prev => {
        const exists = prev.some(
          it =>
            it.product.id === withStock.id &&
            (it.product.variationId ?? null) === (withStock.variationId ?? null)
        );

        const row = { product: { ...withStock, subtotal: subtotalRow }, quantity: qtyResp };

        return exists
          ? prev.map(it =>
            it.product.id === withStock.id &&
              (it.product.variationId ?? null) === (withStock.variationId ?? null)
              ? row
              : it
          )
          : [...prev, row];
      });


      setSelectedProduct("");
      setQuantityText("1");
      toast.success("Product added to cart!");
    } catch (err: any) {
      console.error("addProduct error:", err);
      // will now show the exact “required level” text or any other backend error
      toast.error(err.message || "Could not add product");
    }
  };

  // — Remove Product
  const removeProduct = async (
    productId: string,
    variationId: string | null,
    idx: number
  ) => {
    if (!cartId) {
      toast.error("No cart created yet!");
      return;
    }
    try {
      const res = await fetch(`/api/cart/${cartId}/remove-product`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
        body: JSON.stringify({ productId, variationId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to remove product");
      }
      setOrderItems((prev) => prev.filter((_, i) => i !== idx));
      toast.success("Product removed from cart");
    } catch (error: any) {
      console.error("removeProduct error:", error);
      toast.error(error.message || "Could not remove product");
    }
  };

  /// — Update product quantity
  const updateQuantity = async (
    productId: string,
    variationId: string | null,
    action: "add" | "subtract"
  ) => {
    if (!cartId) return toast.error("Cart hasn’t been created yet!");
    try {
      const res = await fetch(`/api/cart/${cartId}/update-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId,
          // send varId only when we have one (base products can omit it)
          ...(variationId ? { variationId } : {}),
          action,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to update quantity");
      }

      const { lines } = await res.json();

      // ✅ Functional update to avoid stale reads
      setOrderItems((prev) => {
        const mapped: OrderItem[] = lines.map((l: any) => {
          // 1) prev cart row (try id+varId, else id only)
          const prevRow =
            prev.find(
              it =>
                it.product.id === l.id &&
                (it.product.variationId ?? null) === (l.variationId ?? null)
            ) ?? prev.find(it => it.product.id === l.id);

          // 2) stable varId: server → the one we just acted on (for this line) → previous row
          const requestedVarId = variationId ?? null;
          const varId =
            l.variationId ??
            (l.id === productId ? requestedVarId : null) ??
            (prevRow?.product.variationId ?? null);

          // 3) catalog match (nice-to-have for image/stock/etc.)
          const pMatch =
            products.find((p) => p.id === l.id && (p.variationId ?? null) === varId) ??
            products.find((p) => p.id === l.id);

          // 4) persist label + variant SKU
          const title =
            prevRow?.product.title ??
            pMatch?.title ??
            l.title ??
            "";

          const sku =
            prevRow?.product.sku ??
            pMatch?.sku ??
            l.sku ??
            "";

          return {
            product: {
              id: l.id,
              variationId: varId,
              title,
              sku,
              description: prevRow?.product.description ?? pMatch?.description ?? l.description,
              image: prevRow?.product.image ?? pMatch?.image ?? l.image,
              price: l.unitPrice,
              regularPrice: { [clientCountry]: l.unitPrice },
              stockData: prevRow?.product.stockData ?? pMatch?.stockData ?? {},
              allowBackorders: prevRow?.product.allowBackorders ?? pMatch?.allowBackorders,
              subtotal: l.subtotal,
            },
            quantity: l.quantity,
          };
        });

        return mapped;
      });
    } catch (err: any) {
      toast.error(err.message || "Could not update quantity");
    }
  };


  // — Apply coupon
  const applyCoupon = async () => {
    if (!couponCode || !cartId) {
      toast.error("Generate cart first and enter a coupon");
      return;
    }

    try {
      // Always send the raw, undiscounted items subtotal.
      const res = await fetch(`/api/cart/${cartId}/apply-coupon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode.trim(), total: itemsSubtotal }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          err?.error ||
          err?.message ||
          (typeof err === "string" ? err : "Could not apply coupon")
        );
      }

      const data = await res.json();
      //CouponType is stored in data.couponType
      if (data.discountValue !== undefined && data.discountValue !== null) {
        setCouponValues((prev) => [...prev, Number(data.discountValue)]);
      }

      // Use ONLY the server's recomputed values.
      const codes = (data.appliedCodes || "")
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);

      setAppliedCodes(codes);
      setDiscountTotal(Number(data.cumulativeDiscount || 0));
      setCouponBreakdown(Array.isArray(data.breakdown) ? data.breakdown : []);

      // ⬇️ NEW: store couponType by the code you just applied
      setCouponTypeByCode((prev) => {
        const next = { ...prev };
        const type = String(data.discountType ?? "").trim();
        const justApplied = couponCode.trim();
        if (type && justApplied) next[justApplied] = type;

        // keep only types for codes the server says are applied
        for (const k of Object.keys(next)) {
          if (!codes.includes(k)) delete next[k];
        }
        return next;
      });

      setCouponCode("");
      toast.success("Coupon applied!");
    } catch (err: any) {
      toast.error(err.message || "Could not apply coupon");
    }
  };

  // — Add a new address (only address text)
  const addAddress = async () => {
    if (!newAddress) {
      return toast.error("Address field is required");
    }

    try {
      const res = await fetch(`/api/clients/${selectedClient}/address`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SITECRET!,
        },
        body: JSON.stringify({
          clientId: selectedClient,
          address: newAddress,
        }),
      });

      if (!res.ok) throw new Error("Failed to save address");

      const created: Address = await res.json();

      // Immediately refetch the authoritative list (backend already trimmed to 5)
      await loadAddresses();

      setSelectedAddressId(created.id); // focus the one we just added
      setNewAddress("");
      toast.success("Address added");
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to save address");
    }
  };

  const totalBeforeShipping = Math.max(0, itemsSubtotal - discountTotal);
  const total = totalBeforeShipping + shippingCost;

  // 🔧 helpers for Niftipay gating
  const pmSelected = paymentMethods.find((p) => p.id === selectedPaymentMethod);
  const isNiftipaySelected =
    !!pmSelected && /niftipay/i.test(pmSelected.name || "");
  // only require network selection if tenant is actually configured (networks loaded)
  const mustChooseNiftipayNetwork =
    isNiftipaySelected && niftipayNetworks.length > 0;

  // Shipping cost
  useEffect(() => {
    if (!selectedShippingMethod) return;
    const m = shippingMethods.find((m) => m.id === selectedShippingMethod);
    const tier = m?.costs.find(
      (c) =>
        totalBeforeShipping >= c.minOrderCost &&
        (c.maxOrderCost === 0 || totalBeforeShipping <= c.maxOrderCost)
    );
    setShippingCost(tier?.shipmentCost || 0);
  }, [totalBeforeShipping, selectedShippingMethod, shippingMethods]);

  // — Cancel / Create
  const cancelOrder = () => {
    setSelectedClient("");
    setOrderGenerated(false);
    setOrderItems([]);

    // old coupon flags (keep if you still use them somewhere)
    setCouponCode("");

    // NEW: clear stacked coupons state
    setAppliedCodes([]);
    setDiscountTotal(0);
    setCouponBreakdown([]);

    setSelectedPaymentMethod("");
    setClientCountry("");
    setSelectedShippingMethod("");
    setSelectedShippingCompany("");
    setShippingCost(0);
    setCouponTypeByCode({});
    setCouponValues([]);
  };

  const createOrder = async () => {
    if (!orderGenerated) {
      toast.error("Generate your cart first!");
      return;
    }

    // Pre-flight config guards (clear guidance)
    if (!Array.isArray(paymentMethods) || paymentMethods.length === 0) {
      toast.error("You need to set up a payment method first");
      return;
    }
    if (!Array.isArray(shippingMethods) || shippingMethods.length === 0) {
      toast.error("You need to create a shipping method first");
      return;
    }
    if (!Array.isArray(shippingCompanies) || shippingCompanies.length === 0) {
      toast.error("You need to set up a shipping company first");
      return;
    }
    const pmObj = paymentMethods.find((m) => m.id === selectedPaymentMethod);
    const payment = pmObj?.name;
    if (!payment) {
      toast.error("Select a payment method");
      return;
    }
    /* ensure crypto network chosen only if configured */
    const isNiftipay = pmObj?.name?.toLowerCase() === "niftipay";
    const niftipayConfigured = niftipayNetworks.length > 0;
    if (isNiftipay && niftipayConfigured && !selectedNiftipay) {
      toast.error("Select the crypto network/asset");
      return;
    }
    const shippingCompanyName = shippingCompanies.find(
      (c) => c.id === selectedShippingCompany
    )?.name;
    if (!shippingCompanyName) {
      toast.error("Select a shipping company");
      return;
    }
    //pull out the selected SHIPPING METHOD object
    const shippingMethodObj = shippingMethods.find(
      (m) => m.id === selectedShippingMethod
    );
    if (!shippingMethodObj) {
      toast.error("Select a shipping method");
      return;
    }
    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr) {
      toast.error("Select an address");
      return;
    }
    const payload = {
      clientId: selectedClient,
      cartId,
      country: clientCountry,
      paymentMethod: payment,
      shippingAmount: shippingCost,
      shippingMethodTitle: shippingMethodObj.title,
      shippingMethodDescription: shippingMethodObj.description,
      address: addr.address,
      subtotal: itemsSubtotal, // raw items subtotal
      discountAmount: discountTotal, // total discounts from all coupons
      couponCode: appliedCodes.length ? appliedCodes.join(",") : null, // "A,B"
      // ⬇️ NEW: coupon types in the same order as couponCode
      couponType: appliedCodes.length
        ? appliedCodes
          .map((c) => couponTypeByCode[c] || "")
          .filter(Boolean)
          .join(",")
        : null,
      discountValue: couponValues.length ? couponValues : [],
      shippingCompany: shippingCompanyName,
    };

    try {
      const res = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        if (Array.isArray(data.products)) {
          const errs: Record<string, number> = {};
          data.products.forEach((p: any) => {
            errs[p.productId] = p.available;
          });
          setStockErrors(errs);
        }
        // Friendly mapping for common backend messages
        const rawMsg = data?.error || data?.message;
        if (!showFriendlyCreateOrderError(rawMsg)) {
          toast.error(rawMsg || "Failed to create order");
        }
        return;
      }
      toast.success("Order created successfully!");
      /* ── extra: create Niftipay invoice & store meta ───────── */
      if (isNiftipay && niftipayConfigured) {
        const [chain, asset] = selectedNiftipay.split(":");
        const client = clients.find((c) => c.id === selectedClient)!;
        const safeEmail = client.email?.trim() || "user@trapyfy.com";
        const fiat = countryToFiat(client.country); // "GBP" | "EUR" | "USD" | More coming
        const totalF = total; // already includes shippingCost

        const nRes = await fetch(`/api/niftipay/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            network: chain,
            asset,
            amount: totalF,
            currency: fiat,
            firstName: client.firstName,
            lastName: client.lastName,
            email: safeEmail,
            merchantId: activeOrg?.id ?? "",
            reference: data.orderKey,
          }),
        });

        if (!nRes.ok) {
          const msg = await nRes.text();
          console.error("[Niftipay] ", msg);
          if (!showFriendlyCreateOrderError(msg)) {
            toast.error(`Niftipay: ${msg}`);
          }
          return;
        }

        const meta = await nRes.json();
        await fetch(`/api/order/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderMeta: [meta] }),
        });
        toast.success(
          `Niftipay invoice created: send ${fmt(meta.order.amount)} ${asset}`
        );
      }

      cancelOrder();
      router.push(`/orders/${data.id}`);
    } catch (err: any) {
      console.error("createOrder error:", err);
      if (!showFriendlyCreateOrderError(err?.message)) {
        toast.error(err?.message || "Could not create order");
      }
    }
  };

  const clientEmail =
    clients.find((c) => c.id === selectedClient)?.email;

  const createDisabled =
    !orderGenerated ||
    orderItems.length === 0 ||
    !selectedPaymentMethod ||
    // 🔧 only force a network when Niftipay is selected *and* configured
    (mustChooseNiftipayNetwork ? !selectedNiftipay : false) ||
    !selectedShippingMethod ||
    !selectedShippingCompany;

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Create New Order</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          {/* Client Selection (now fully inside the component) */}
          <ClientSelect
            selectedClient={selectedClient}
            clientsLoading={clientsLoading}
            orderGenerated={orderGenerated}
            clients={clients}
            filteredClients={filteredClients}
            searchResults={searchResults}
            searching={searching}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            pickClient={pickClient}
            onGenerateOrder={generateOrder}
          />
          {/* Product Selection */}

          <ProductSelect
            orderGenerated={orderGenerated}
            orderItems={orderItems}
            clientCountry={clientCountry}
            stockErrors={stockErrors}
            removeProduct={removeProduct}
            updateQuantity={updateQuantity}
            addProduct={addProduct}
            productsLoading={productsLoading}
            selectedProduct={selectedProduct}
            prodTerm={prodTerm}
            setProdTerm={setProdTerm}
            filteredProducts={filteredProducts}
            prodResults={prodResults}
            prodSearching={prodSearching}
            products={products}
            pickProduct={pickProduct}
            groupByCategory={groupByCategory}
            quantityText={quantityText}
            setQuantityText={setQuantityText}
            parseQty={parseQty}
          />

          {/* Discount Coupon (moved into its own component) */}
          <DiscountCoupon
            orderGenerated={orderGenerated}
            appliedCodes={appliedCodes}
            discountTotal={discountTotal}
            clientCountry={clientCountry}
            couponCode={couponCode}
            setCouponCode={setCouponCode}
            couponBreakdown={couponBreakdown}
            applyCoupon={applyCoupon}
          />

          {/* Shipping Address (moved into its own component) */}
          <ShippingAddress
            orderGenerated={orderGenerated}
            addresses={addresses}
            selectedAddressId={selectedAddressId}
            setSelectedAddressId={setSelectedAddressId}
            newAddress={newAddress}
            setNewAddress={setNewAddress}
            addAddress={addAddress}
          />

          {/* Shipping Section */}
          <ShippingOptions
            orderGenerated={orderGenerated}
            shippingLoading={shippingLoading}
            shippingMethods={shippingMethods}
            selectedShippingMethod={selectedShippingMethod}
            setSelectedShippingMethod={setSelectedShippingMethod}
            shippingCompanies={shippingCompanies}
            selectedShippingCompany={selectedShippingCompany}
            setSelectedShippingCompany={setSelectedShippingCompany}
            totalBeforeShipping={totalBeforeShipping}
          />

          {/* Payment Methods */}
          <PaymentMethod
            orderGenerated={orderGenerated}
            paymentMethods={paymentMethods}
            selectedPaymentMethod={selectedPaymentMethod}
            setSelectedPaymentMethod={setSelectedPaymentMethod}
            niftipayNetworks={niftipayNetworks}
            niftipayLoading={niftipayLoading}
            selectedNiftipay={selectedNiftipay}
            setSelectedNiftipay={setSelectedNiftipay}
          />
        </div>

        {/* RIGHT COLUMN: Order Summary (moved into its own component) */}
        <div className="lg:col-span-1">
          <OrderSummary
            orderGenerated={orderGenerated}
            clientEmail={clientEmail}
            itemsCount={orderItems.length}
            itemsSubtotal={itemsSubtotal}        // NEW: show subtotal
            discountTotal={discountTotal}
            shippingCost={shippingCost}
            total={total}
            clientCountry={clientCountry}
            createDisabled={createDisabled}
            onCreateOrder={createOrder}
          />
        </div>
      </div>
    </div>
  );
}
