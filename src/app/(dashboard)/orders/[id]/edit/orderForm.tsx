// src/app/(dashboard)/orders/[id]/edit/orderForm.tsx
"use client";

import React, { useState, useEffect } from "react";
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
  Minus,
  Plus,
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
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
}
interface OrderItem {
  product: Product;
  quantity: number;
  isAffiliate: boolean;
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

const NIFTIPAY_BASE =
  (process.env.NEXT_PUBLIC_NIFTIPAY_API_URL || "https://www.niftipay.com")
    .replace(/\/+$/, "");          // strip trailing “/” just in case

function mergeLinesByProduct(
  lines: Array<{
    id: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    isAffiliate: boolean;
    [key: string]: any;
  }>
) {
  const map: Record<
    string,
    { quantity: number; subtotal: number; lines: typeof lines }
  > = {};

  for (const line of lines) {
    if (!map[line.id]) {
      map[line.id] = {
        quantity: 0,
        subtotal: 0,
        lines: [],
      };
    }
    map[line.id].quantity += line.quantity;
    map[line.id].subtotal += line.subtotal;
    map[line.id].lines.push(line);
  }

  return Object.values(map).map(({ lines, quantity, subtotal }) => ({
    ...lines[0], // Keep the first line’s metadata (title, sku, etc.)
    quantity, // Summed quantity
    subtotal, // Summed subtotal
  }));
}

function groupByProduct(lines: OrderItemLine[]) {
  return lines.reduce(
    (acc, line) => {
      let bucket = acc.find((b) => b.id === line.id);
      if (!bucket) {
        bucket = {
          id: line.id,
          title: line.title,
          sku: line.sku,
          description: line.description,
          image: line.image,
          isAffiliate: line.isAffiliate,
          priceBuckets: [] as { unitPrice: number; quantity: number }[],
        };
        acc.push(bucket);
      }
      // find the matching price‐bucket
      const pb = bucket.priceBuckets.find(
        (p) => p.unitPrice === line.unitPrice
      );
      if (pb) {
        pb.quantity += line.quantity;
      } else {
        bucket.priceBuckets.push({
          unitPrice: line.unitPrice,
          quantity: line.quantity,
        });
      }
      return acc;
    },
    [] as Array<{
      id: string;
      title: string;
      sku: string;
      description: string;
      image: string;
      isAffiliate: boolean;
      priceBuckets: { unitPrice: number; quantity: number }[];
    }>
  );
}

async function fetchJsonVerbose(
  url: string,
  opts: RequestInit = {},
  tag = url,
) {
  const res = await fetch(url, opts);
  let body: any = null;
  try {
    body = await res.clone().json();   // clone → still readable later
  } catch { /* not JSON */ }

  console.log(`[${tag}]`, res.status, body ?? "(non-json)");
  return res;
}


export default function OrderFormVisual({ orderId }: OrderFormWithFetchProps) {
  const router = useRouter();
   const { data: activeOrg } = authClient.useActiveOrganization();
   const merchantId = activeOrg?.id ?? "";
  /* ——————————————————— STATE ——————————————————— */
  const [orderData, setOrderData] = useState<any | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [total, setTotal] = useState(0);
  const [clientCountry, setClientCountry] = useState("");
  const [cartId, setCartId] = useState("");

  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});

  const [productsLoading, setProductsLoading] = useState(true);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState(1);

  const [addresses, setAddresses] = useState<{ id: string; address: string }[]>(
    []
  );
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(
    null
  );
  const [newAddress, setNewAddress] = useState("");

  const [showNewCoupon, setShowNewCoupon] = useState(false);
  const [newCoupon, setNewCoupon] = useState("");

  const [couponApplied, setCouponApplied] = useState(false);
  const [couponCode, setCouponCode] = useState("");

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    "fixed"
  );
  const [discount, setDiscount] = useState<number>(0); // ← number, never null
  const [value, setValue] = useState<number>(0); // ← “

  const [shippingLoading, setShippingLoading] = useState(true);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>(
    []
  );
  const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
  const [selectedShippingMethod, setSelectedShippingMethod] = useState("");
  const [rawLines, setRawLines] = useState<OrderItemLine[]>([]);
  interface PaymentMethod {
    id: string;
    name: string;
    apiKey?: string | null;
  }
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [niftipayNetworks, setNiftipayNetworks] = useState<
    { chain: string; asset: string; label: string }[]
  >([]);
  const [niftipayLoading, setNiftipayLoading] = useState(false);
  const [selectedNiftipay, setSelectedNiftipay] = useState(""); // "chain:asset"
  /* ——————————————————— HELPERS ——————————————————— */
  const calcRowSubtotal = (p: Product, qty: number) =>
    (p.regularPrice[clientCountry] ?? p.price) * qty;

  async function loadCart() {
    try {
      const res = await fetch(`/api/cart/${cartId}`, {
        headers: { "Content-Type": "application/json" },
      });
      const { resultCartProducts } = await res.json();

      // 1️⃣ update rawLines (for grouped UI)
      setRawLines(resultCartProducts);

      // 2️⃣ update orderItems (for subtotal/total logic)
      setOrderItems(
        resultCartProducts.map((l) => ({
          product: {
            id: l.id,
            title: l.title,
            sku: l.sku,
            description: l.description,
            image: l.image,
            regularPrice: { [clientCountry]: l.unitPrice },
            price: l.unitPrice,
            subtotal: l.subtotal,
            stockData: {},
          },
          quantity: l.quantity,
          isAffiliate: l.isAffiliate,
        }))
      );
    } catch (e: any) {
      toast.error(e.message || "Failed loading cart");
    }
  }

  /* ——————————————————— EFFECTS ——————————————————— */
  useEffect(() => {
    const sum = orderItems
      .filter((item) => !item.isAffiliate) // ← ignore affiliate lines
      .reduce(
        (acc, item) =>
          acc +
          (item.product.subtotal ??
            calcRowSubtotal(item.product, item.quantity)),
        0
      );
    setSubtotal(sum);
  }, [orderItems, clientCountry]);

  // total recalculation
  useEffect(() => {
    if (!orderData) return;
    const shipping = orderData.shipping ?? 0;
    const couponDisc = couponApplied ? discount : (orderData.discount ?? 0);
    const pointsDisc = orderData.pointsRedeemedAmount ?? 0;

    setDiscountType(couponApplied ? discountType : orderData.discountType);
    setDiscount(Number(couponDisc));

    // include both coupon‐ and points‐discount
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
        const res = await fetch(`/api/order/${orderId}`);
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

  const groupedItems = groupByProduct(rawLines);

  /* ——————————————————— LOAD STATIC DATA ——————————————————— */
  useEffect(() => {
    loadProducts();
    loadShipping();
  }, []);

  async function loadProducts() {
    setProductsLoading(true);
    try {
      // no custom headers needed
      const [normRes, affRes] = await Promise.all([
        fetch("/api/products"),
        fetch("/api/affiliate/products"),
      ]);
      if (!normRes.ok || !affRes.ok) {
        throw new Error("Failed to fetch product lists");
      }

      const { products: norm } = await normRes.json(); // [{ id,…, regularPrice, stockData, … }]
      const { products: aff } = await affRes.json(); // [{ id,…, pointsPrice, cost, stock?, … }]

      // map both into our UI shape
      const all: Product[] = [
        // 1) real products
        ...norm.map((p) => ({
          id: p.id,
          title: p.title,
          sku: p.sku,
          description: p.description,
          image: p.image,
          regularPrice: p.regularPrice,
          // use the first country’s salePrice or regularPrice as fallback price
          price: Object.values(p.salePrice ?? p.regularPrice)[0] ?? 0,
          stockData: p.stockData,
          subtotal: 0,
        })),

        // 2) affiliate products
        ...aff.map((a) => {
          // pick “first” level then “first” country to derive a flat points → € price
          const lvlKeys = Object.keys(a.pointsPrice);
          const countryKeys = lvlKeys.length
            ? Object.keys(a.pointsPrice[lvlKeys[0]])
            : [];
          const firstCountry = countryKeys[0] ?? "";
          const price = a.cost[firstCountry] ?? 0;

          // build a regularPrice map so the UI can treat it the same:
          // use cost in every country as the “currency” price
          const regularPrice: Record<string, number> = Object.fromEntries(
            Object.entries(a.cost).map(([country, c]) => [country, c])
          );

          return {
            id: a.id,
            title: a.title,
            sku: a.sku,
            description: a.description,
            image: a.image,
            regularPrice,
            price,
            stockData: a.stock ?? {},
            subtotal: 0,
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

  /* ────────────────────────────────────────────────────────────
   Fetch payment methods + (if Niftipay) chains/assets
──────────────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const pmRes = await fetch("/api/payment-methods");
        const { methods } = await pmRes.json();
        setPaymentMethods(methods);
        console.log("[Trapigram] Loaded payment methods", {
          methods: methods.map((m: any) => ({
            id: m.id,
            name: m.name,
            apiKey: m.apiKey ? m.apiKey.slice(0, 8) + "..." : "null",
          })),
        });
        const init = methods.find(
          (m: any) =>
            m.name.toLowerCase() === orderData?.shippingInfo.payment?.toLowerCase()
        )?.id;
        if (init) setSelectedPaymentMethod(init);
      } catch (e) {
        toast.error("Failed loading payment methods");
      }
    })();
  }, [orderData]);

  useEffect(() => {
    const pm = paymentMethods.find((p) => p.id === selectedPaymentMethod);
    if (!pm || pm.name.toLowerCase() !== "niftipay" || !pm.apiKey) {
      setNiftipayNetworks([]);
      setSelectedNiftipay("");
      return;
    }
    (async () => {
      try {
        setNiftipayLoading(true);
        const res = await fetch("/api/niftipay/payment-methods", {
          headers: { "x-api-key": pm.apiKey },
        });
        const { methods } = await res.json();
        setNiftipayNetworks(
          methods.map((m: any) => ({
            chain: m.chain,
            asset: m.asset,
            label: m.label ?? `${m.asset} on ${m.chain}`,
          }))
        );
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setNiftipayLoading(false);
      }
    })();
  }, [selectedPaymentMethod, paymentMethods]);


  const countryProducts = products.filter((p) => {
    // if no stockData at all (affiliate), show it
    if (!Object.keys(p.stockData).length) return true;

    // otherwise only those with stock in this country
    const totalStock = Object.values(p.stockData).reduce(
      (sum, e) => sum + (e[clientCountry] || 0),
      0
    );
    return totalStock > 0;
  });

  const loadShipping = async () => {
    setShippingLoading(true);
    try {
          const [shipRes, compRes] = await Promise.all([
              fetch("/api/shipments"),
              fetch("/api/shipping-companies"),
            ]);
      const shipData = await shipRes.json();
      const compData = await compRes.json();
      setShippingMethods(shipData.shipments);
      setShippingCompanies(compData.shippingMethods);
    } catch (e) {
      toast.error("Shipping load error");
    } finally {
      setShippingLoading(false);
    }
  };

  // Auto-select the shipping method once both orderData and shippingMethods are ready
  useEffect(() => {
    if (orderData && shippingMethods.length) {
      const match = shippingMethods.find(
        (m) =>
          // if your API gives you the ID:
          m.id === orderData.shippingInfo.method ||
          // or if it gives you the title:
          m.title === orderData.shippingInfo.method
      );
      console.log(match);
      if (match) setSelectedShippingMethod(match.id);
    }
  }, [orderData, shippingMethods]);

  // Auto-select the shipping company once both orderData and shippingCompanies are ready
  useEffect(() => {
    if (orderData && shippingCompanies.length) {
      const match = shippingCompanies.find(
        (c) =>
          // if your API gives you the ID:
          c.id === orderData.shippingInfo.company ||
          // or if it gives you the name:
          c.name === orderData.shippingInfo.company
      );
      if (match) setSelectedShippingCompany(match.id);
    }
  }, [orderData, shippingCompanies]);

  // Add new address then re-fetch list and select it
  const handleAddAddress = async () => {
    if (!newAddress || !orderData?.clientId) return;
    const newAddrText = newAddress; // keep the text before clearing
    try {
      const res = await fetch(`/api/clients/${orderData.clientId}/address`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: newAddrText }),
      });
      if (!res.ok) throw new Error("Failed to add address");
      setNewAddress(""); // clear input

      // Refresh list
      const upd = await fetch(`/api/clients/${orderData.clientId}/address`);
      const addrData = await upd.json();
      setAddresses(addrData.addresses);

      // Auto-select the one we just added
      const match = addrData.addresses.find(
        (a: any) => a.address === newAddrText
      );
      if (match) {
        setSelectedAddressId(match.id);
      }
    } catch (err: any) {
      console.error(err);
      toast.error("Could not add address");
    }
  };

  // Apply coupon
  const handleApplyCoupon = async () => {
    if (!newCoupon || !orderData?.cartId || !orderData?.id) return;
    try {
      // First PATCH to apply coupon
      const patchRes = await fetch(
        `/api/cart/${orderData.cartId}/apply-coupon`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: newCoupon, total: subtotal }),
        }
      );
      if (!patchRes.ok) throw new Error("Failed to apply coupon to cart");
      const data = await patchRes.json();
      const {
        discountAmount: amt,
        discountType: dt,
        discountValue: dv,
        cc,
      } = data;

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

      // Refresh order and reset UI
      setNewCoupon(newCoupon);
      setShowNewCoupon(true);
    } catch (err) {
      console.error(err);
    }
  };

  // — Add product
  const addProduct = async () => {
    if (!selectedProduct || !cartId)
      return toast.error("Cart hasn’t been created yet!");

    const product = products.find((p) => p.id === selectedProduct);
    if (!product) return;
    const unitPrice = product.regularPrice[clientCountry] ?? product.price;

    try {
      const res = await fetch(`/api/cart/${cartId}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedProduct,
          quantity,
          price: unitPrice,
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
      const { product: added, quantity: qty } = await res.json();
      const subtotalRow = calcRowSubtotal(added, qty);

      await loadCart();
      setSelectedProduct("");
      setQuantity(1);
      toast.success("Product added to cart!");
    } catch (error: any) {
      console.error("addProduct error:", error);
      toast.error(error.message || "Could not add product");
    }
  };

  // — Remove Product
  const removeProduct = async (productId: string, idx: number) => {
    if (!cartId) {
      toast.error("No cart created yet!");
      return;
    }
    try {
      const res = await fetch(`/api/cart/${cartId}/remove-product`, {
             method: "DELETE",
             headers: { "Content-Type": "application/json" },
             body: JSON.stringify({ productId }),
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

  // — Update product quantity
  // — Update product quantity
  // src/app/(dashboard)/orders/[id]/edit/orderForm.tsx

  const updateQuantity = async (
    productId: string,
    action: "add" | "subtract"
  ) => {
    if (!cartId) {
      toast.error("Cart hasn’t been created yet!");
      return;
    }
    try {
      const res = await fetch(`/api/cart/${cartId}/update-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("PATCH /order failed", body);
        throw new Error(body.error || "Failed to update quantity");
      }

      // 🎯 Consume the PATCH response and immediately update UI
      // 🎯 consume the PATCH response
      const { lines } = await res.json();

      // 1️⃣ keep **all** rows so bucket-view can distinguish unit prices
      setRawLines(lines);

      // 2️⃣ aggregate only for sidebar math
      const aggregated = mergeLinesByProduct(lines);
      setOrderItems(
        aggregated.map((l: any) => ({
          product: {
            id: l.id,
            title: l.title,
            sku: l.sku,
            description: l.description,
            image: l.image,
            regularPrice: { [clientCountry]: l.unitPrice },
            price: l.unitPrice,
            subtotal: l.subtotal,
            stockData: {},
          },
          quantity: l.quantity,
          isAffiliate: l.isAffiliate,
        }))
      );

      toast.success(
        `Quantity ${action === "add" ? "increased" : "decreased"}!`
      );
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // New: update order
  const handleUpdateOrder = async () => {
    if (!orderData?.id) return;

    try {
      /* --- 0. Handle Niftipay "switch-away" case --- */
      /* ----------------------------------------------------------
 * 0. Handle DELETE of the previous Niftipay invoice
 *    • case A – user switches to another payment method
 *    • case B – still Niftipay but picks a *different* chain/asset
 * ---------------------------------------------------------- */
      const pmObj = paymentMethods.find(p => p.id === selectedPaymentMethod);
      const oldPM = orderData.shippingInfo.payment?.toLowerCase();
      const newPM = pmObj?.name.toLowerCase();

      /* extract previous network:asset if we have orderMeta */
      const prevNA =
        orderData.orderMeta?.[0]?.order
          ? `${orderData.orderMeta[0].order.network}:${orderData.orderMeta[0].order.asset}`
          : null;

      const needDelete =
        oldPM === "niftipay" && (
              /* A */ newPM !== "niftipay" ||
              /* B */ (newPM === "niftipay" &&
            prevNA &&                     // we know the previous invoice
            selectedNiftipay &&           // user picked a coin
            selectedNiftipay !== prevNA)  // … and it changed
        );

      if (needDelete) {
        const niftipayMethod = paymentMethods.find(p => p.name.toLowerCase() === "niftipay");
        const key = niftipayMethod?.apiKey;
        if (!key) {
          console.error("[Trapigram] Niftipay API key missing for DELETE");
          toast.error("Niftipay API key missing");
          return;
        }

        // Log DELETE request details
       
        console.log("[Trapigram] Attempting to delete Niftipay order", {
          reference: orderData.orderKey,
          apiKey: key ? key.slice(0, 8) + "..." : "undefined",
          merchantId,
          url: `${NIFTIPAY_BASE}/api/orders?reference=${encodeURIComponent(orderData.orderKey)}`,
        });

        const del = await fetchJsonVerbose(
          `/api/niftipay/orders?reference=${encodeURIComponent(orderData.orderKey)}`,
          {
            method: "DELETE",
            headers: { "x-api-key": key },
          },
          "DELETE Niftipay",
        );


        if (!(del.ok || del.status === 404)) {
          const errorBody = await del.json().catch(() => ({ error: "Unknown error" }));
          console.error("[Trapigram] DELETE request failed", {
            status: del.status,
            error: errorBody.error,
            reference: orderData.orderKey,
          });
          toast.error(errorBody.error || `Failed to delete Niftipay order (${del.status})`);
          return;
        }

        console.log("[Trapigram] Previous Niftipay invoice gone (status", del.status, ")");
        console.log("[Trapigram] Niftipay order deleted successfully", {
          status: del.status,
          reference: orderData.orderKey,
        });
      }

      /* --- 1. Patch the order itself --- */
      const selectedAddressText = addresses.find(a => a.id === selectedAddressId)?.address ?? null;




      const headers: HeadersInit = { "Content-Type": "application/json" };

      const res = await fetchJsonVerbose(`/api/order/${orderData.id}`, {
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
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Request failed (${res.status})`);
      }

      /* --- 2. (Re-)create Niftipay invoice if it’s the chosen method --- */
      if (newPM === "niftipay") {
        const key = pmObj?.apiKey;

        if (!key) {
          toast.error("Niftipay API key missing");
          return;
        } else if (!selectedNiftipay) {
          toast.error("Select crypto network/asset first");
          return;
        }

        const [chain, asset] = selectedNiftipay.split(":");
        // Log creation of new Niftipay order
        console.log("[Trapigram] Creating new Niftipay order", {
          reference: orderData.orderKey,
          chain,
          asset,
          merchantId,
        });

        console.log("pmObj", pmObj);
        console.log("header being sent", pmObj?.apiKey ?? "<empty>");


        const niftipayRes = await fetch("/api/niftipay/orders", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": pmObj!.apiKey!,   // ✅  always include when talking to Niftipay
          },
          body: JSON.stringify({
            network: chain,
            asset,
            amount: total,
            currency: orderData.currency ?? "EUR",
            firstName: orderData.client.firstName,
            lastName: orderData.client.lastName,
            email: orderData.client.email ?? "user@trapyfy.com",
            merchantId,
            reference: orderData.orderKey,
          }),
        });

        if (!niftipayRes.ok) {
          const errorBody = await niftipayRes.json().catch(() => ({ error: "Unknown error" }));
          console.error("[Trapigram] Failed to create new Niftipay order", {
            status: niftipayRes.status,
            error: errorBody.error,
          });
          toast.error(errorBody.error || "Failed to create new Niftipay order");
          return;
        }

        const niftipayMeta = await niftipayRes.json();
        console.log("[Trapigram] Niftipay order created successfully", niftipayMeta);

        // Update Trapigram order with Niftipay metadata
               await fetch(`/api/order/${orderData.id}`, {
                   method: "PATCH",
                   headers: { "Content-Type": "application/json" },
                   body: JSON.stringify({ orderMeta: [niftipayMeta] }),
                 });
        toast.success(`Niftipay invoice created: send ${niftipayMeta.order.amount} ${asset}`);
      }

      toast.success("Order updated!");
      router.push("/orders");
    } catch (err: any) {
      toast.error(err.message || "Update failed");
    }
  };


  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Update Order</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          {/* Show Username */}
          {/* Order information -------------------------------------------------- */}
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

          {/* Product Selection */}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Product Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {orderItems.length > 0 && (
                <div className="space-y-4 mb-4">
                  {groupedItems.map((item) => {
                    const totalQty = item.priceBuckets.reduce(
                      (a, p) => a + p.quantity,
                      0
                    );
                    const firstBucket = item.priceBuckets[0];
                    return (
                      <div key={item.id} className="border rounded-lg p-4">
                        <div className="flex justify-between items-center">
                          <div className="flex items-center space-x-4">
                            {item.image ? (
                              <Image
                                src={item.image}
                                alt={item.title}
                                width={80}
                                height={80}
                                className="rounded-md"
                              />
                            ) : (
                              <div className="w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center text-gray-400">
                                No image
                              </div>
                            )}
                            <div>
                              <h3 className="font-medium">{item.title}</h3>
                              <p className="text-sm text-gray-500">
                                SKU: {item.sku}
                              </p>
                              <div
                                className="text-sm"
                                dangerouslySetInnerHTML={{
                                  __html: item.description,
                                }}
                              />
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              removeProduct(item.id, /* idx not used */ 0)
                            }
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="mt-4 flex justify-between items-center">
                          {/* quantity controls */}
                          <div className="flex items-center space-x-2">
                            <Button
                              size="icon"
                              onClick={() =>
                                updateQuantity(item.id, "subtract")
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="font-medium">
                              {totalQty} unit{totalQty > 1 ? "s" : ""}
                            </span>
                            <Button
                              size="icon"
                              onClick={() => updateQuantity(item.id, "add")}
                            >
                              <Plus className="h-4 w-4" />
                            </Button>
                          </div>
                          {/* cheapest bucket price for header */}
                          <span className="font-medium">
                            {formatCurrency(firstBucket.unitPrice, clientCountry)} each
                          </span>
                        </div>

                        {/* breakdown of different unit prices */}
                        {item.priceBuckets.length > 1 && (
                          <ul className="mt-2 text-sm text-gray-600 space-y-1">
                            {item.priceBuckets.map((pb) => (
                              <li key={pb.unitPrice}>
                                {pb.quantity} × {formatCurrency(pb.unitPrice, clientCountry)}
                              </li>
                            ))}
                          </ul>
                        )}

                        {/* line subtotal */}
                        <div className="mt-4 text-right font-medium">
                          {formatCurrency(
                            item.priceBuckets.reduce(
                              (sum, pb) => sum + pb.quantity * pb.unitPrice,
                              0
                            ),
                            clientCountry
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
                    onValueChange={setSelectedProduct}
                    disabled={productsLoading}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={
                          productsLoading ? "Loading…" : "Select a product"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {countryProducts.map((p) => {
                        const price = p.regularPrice[clientCountry];
                        const stockCount = Object.values(p.stockData).reduce(
                          (sum, e) => sum + (e[clientCountry] || 0),
                          0
                        );
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title} — ${price} — Stock: {stockCount}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-24">
                  <Label>Quantity</Label>
                  <Input
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) =>
                      setQuantity(Math.max(1, parseInt(e.target.value) || 1))
                    }
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

          {/* Discount Coupon */}

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

          {/* Shipping Address */}
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
                    <span className="text-sm">{addr.address}</span>
                  </label>
                ))}
              </div>
              <Separator className="my-3" />
              <div className="flex gap-4">
                <Input
                  className="flex-1"
                  placeholder="New address"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                />
                <Button onClick={handleAddAddress} disabled={!newAddress}>
                  Add Address
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Shipping Method & Company */}
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
                        placeholder={
                          shippingLoading ? "Loading…" : "Select method"
                        }
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
                        placeholder={
                          shippingLoading ? "Loading…" : "Select company"
                        }
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

          {/* Payment Method */}
          {/* Payment Method (now editable) */}
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
                          placeholder={
                            niftipayLoading ? "Loading…" : "Select network"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {niftipayNetworks.map((n) => (
                          <SelectItem
                            key={`${n.chain}:${n.asset}`}
                            value={`${n.chain}:${n.asset}`}
                          >
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
                      -${orderData.pointsRedeemedAmount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-green-600">
                  <span>
                    Discount
                    {discountType === "percentage"
                      ? ` (${value.toFixed(2)}%)`
                      : ""}
                    :
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
