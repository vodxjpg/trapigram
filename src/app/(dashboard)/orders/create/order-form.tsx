"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  Package,
  Minus,
  Plus,
  Trash2,
  User,
  Check,
  Tag,
  DollarSign,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/currency";
// Interfaces
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
interface PaymentMethod {
  id: string;
  name: string;
  details: string;
  apiKey?: string | null;
}

/* ─── helpers (new) ───────────────────────────────────────────── */
/* ─── currency map helpers ─────────────────────────────────────── */
const EU_COUNTRIES = new Set([
    "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU",
    "IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
  ]);
  
  function countryToFiat(c: string): string {
    const code = c.toUpperCase();
    if (code === "GB")            return "GBP";
    if (EU_COUNTRIES.has(code))   return "EUR";
    return "USD";
  }

function fmt(n: number | string): string {
  return Number(n).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}

export default function OrderForm() {
  const router = useRouter();

  // States

  const [clients, setClients] = useState<any[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState("");
  const [clientCountry, setClientCountry] = useState("");

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
  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [productsLoading, setProductsLoading] = useState(true);

  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    "fixed"
  );
  const [discount, setDiscount] = useState(0);
  const [value, setValue] = useState(0);

  const [addresses, setAddresses] = useState<Address[]>([]);
  const [newAddress, setNewAddress] = useState("");
  const [selectedAddressId, setSelectedAddressId] = useState("");

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

  const [subtotal, setSubtotal] = useState(0);

  const calcRowSubtotal = (p: Product, qty: number) => p.price * qty;

  // Added useEffect to recalculate subtotal whenever orderItems change
  useEffect(() => {
    const sum = orderItems.reduce(
      (acc, item) =>
        acc +
        (item.product.subtotal ?? calcRowSubtotal(item.product, item.quantity)),
      0
    );
    setSubtotal(sum);
  }, [orderItems, clientCountry]);

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
    try {
      const resC = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClient }),
      });
      if (!resC.ok) throw new Error("Failed to create cart");
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
          resultCartProducts.map((r: any) => ({
            product: {
              id: r.id,
              title: r.title,
              sku: r.sku,
              description: r.description,
              image: r.image,
              price: r.unitPrice,
              regularPrice: {},
              stockData: {},
              subtotal: r.subtotal,
            },
            quantity: r.quantity,
          }))
        );
      }

      const subtotal = resultCartProducts.reduce((accumulator, current) => {
        return accumulator + current.subtotal;
      }, 0);

      setSubtotal(subtotal);

      const client = clients.find((c) => c.id === selectedClient);
      if (client) setClientCountry(client.country);

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

        const compRes = await fetch("/api/shipping-companies", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        if (!compRes.ok) throw new Error("Failed to fetch shipping companies");
        const comps: { companies: ShippingCompany[] } = await compRes.json();
        setShippingCompanies(comps.shippingMethods);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setShippingLoading(false);
      }

      toast.success("Cart created!");
      setOrderGenerated(true);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  async function loadProducts() {
    setProductsLoading(true);
    try {
      const res = await fetch("/api/products", {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
      });
      const { products } = await res.json();
      setProducts(products);
    } catch {
      toast.error("Failed loading products");
    } finally {
      setProductsLoading(false);
    }
  }

  const countryProducts = products.filter((p) => {
    const totalStock = Object.values(p.stockData).reduce(
      (sum, e) => sum + (e[clientCountry] || 0),
      0
    );
    return totalStock > 0;
  });

  useEffect(() => {
    if (!selectedClient) return;
    const loadAddresses = async () => {
      try {
        const res = await fetch(`/api/clients/${selectedClient}/address`, {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        const data = await res.json();
        setAddresses(data.addresses);
        if (data.addresses.length && !selectedAddressId)
          setSelectedAddressId(data.addresses[0].id);
      } catch (e) {
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
        setShippingCompanies(compData.shippingMethods);
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
    if (!pm || pm.name.toLowerCase() !== "niftipay" || !pm.apiKey) {
      setNiftipayNetworks([]);
      setSelectedNiftipay("");
      return;
    }
    (async () => {
      try {
        setNiftipayLoading(true);
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_NIFTIPAY_API_URL}/api/payment-methods`,
          { headers: { "x-api-key": pm.apiKey } },
        );
        if (!res.ok) throw new Error("Failed to load Niftipay networks");
        const { methods } = await res.json();
        setNiftipayNetworks(
          methods.map((m: any) => ({
            chain: m.chain,
            asset: m.asset,
            label: m.label ?? `${m.asset} on ${m.chain}`,
          })),
        );
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setNiftipayLoading(false);
      }
    })();
  }, [selectedPaymentMethod, paymentMethods]);

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
          unitPrice,
          country: clientCountry,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to add product");
      }
      const { product: added, quantity: qty } = await res.json();
      const subtotalRow = calcRowSubtotal(added, qty);

      setOrderItems((prev) => {
        if (prev.some((it) => it.product.id === added.id)) {
          return prev.map((it) =>
            it.product.id === added.id
              ? { product: { ...added, subtotal: subtotalRow }, quantity: qty }
              : it
          );
        }
        return [
          ...prev,
          { product: { ...added, subtotal: subtotalRow }, quantity: qty },
        ];
      });

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
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
        body: JSON.stringify({ productId }),
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

  // — Update product quantity
  const updateQuantity = async (
    productId: string,
    action: "add" | "subtract"
  ) => {
    if (!cartId) return toast.error("Cart hasn’t been created yet!");
    try {
      const res = await fetch(`/api/cart/${cartId}/update-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to update quantity");
      }
      // 🔸 NEW: API now returns { lines: […] }
      const { lines } = await res.json();

      const mapped: OrderItem[] = lines.map((l: any) => ({
        product: {
          id: l.id,
          title: l.title,
          sku: l.sku,
          description: l.description,
          image: l.image,
          price: l.unitPrice,
          regularPrice: { [clientCountry]: l.unitPrice },
          stockData: {},
          subtotal: l.subtotal,
        },
        quantity: l.quantity,
      }));

      setOrderItems(mapped);
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
      const res = await fetch(`/api/cart/${cartId}/apply-coupon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode, total: subtotal }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error);
      }
      const data = await res.json();
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
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
        },
        body: JSON.stringify({
          clientId: selectedClient,
          address: newAddress,
        }),
      });
      if (!res.ok) throw new Error("Failed to save address");
      const created: Address = await res.json();
      setAddresses((prev) => [...prev, created]);
      setSelectedAddressId(created.id);
      setNewAddress("");
      toast.success("Address added");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const total = subtotal - discount;

  // Shipping cost
  useEffect(() => {
    if (!selectedShippingMethod) return;
    const m = shippingMethods.find((m) => m.id === selectedShippingMethod);
    const tier = m?.costs.find(
      (c) =>
        total >= c.minOrderCost &&
        (c.maxOrderCost === 0 || total <= c.maxOrderCost)
    );
    setShippingCost(tier?.shipmentCost || 0);
  }, [total, selectedShippingMethod]);

  // — Cancel / Create
  const cancelOrder = () => {
    setSelectedClient("");
    setOrderGenerated(false);
    setOrderItems([]);
    setCouponCode("");
    setCouponApplied(false);
    setDiscount(0);
    setSelectedPaymentMethod("");
    setClientCountry("");
    setSelectedShippingMethod("");
    setSelectedShippingCompany("");
    setShippingCost(0);
  };

  const createOrder = async () => {
    if (!orderGenerated) {
      toast.error("Generate your cart first!");
      return;
    }
    const pmObj = paymentMethods.find(
      (m) => m.id === selectedPaymentMethod
    );
    const payment = pmObj?.name;
    if (!payment) {
      toast.error("Select a payment method");
      return;
    }
    /* ensure crypto network chosen */
    const isNiftipay = payment.toLowerCase() === "niftipay";
    if (isNiftipay && !selectedNiftipay) {
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
    const shippingAmount = shippingCost;
    const discountAmount = discount;

    const payload = {
      clientId: selectedClient,
      cartId,
      country: clientCountry,
      paymentMethod: payment,
      shippingAmount,
      shippingMethodTitle: shippingMethodObj.title,
      shippingMethodDescription: shippingMethodObj.description,
      discountAmount,
      couponCode: couponCode || null,
      counponType: discountType,
      shippingCompany: shippingCompanyName,
      address: addr.address,
      subtotal: subtotal,
      discountType,
      discountValue: value,
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
        throw new Error(data.error || "Failed to create order");
      }
      toast.success("Order created successfully!");
      /* ── extra: create Niftipay invoice & store meta ───────── */
      if (isNiftipay) {
        const key = pmObj?.apiKey;
        if (!key) {
          toast.error("Niftipay API-key missing");
          return;
        }
        const [chain, asset] = selectedNiftipay.split(":");

        const client = clients.find((c) => c.id === selectedClient)!;
        const fiat = countryToFiat(client.country);
        const totalF = total + shippingCost;

        const nRes = await fetch(
          `${process.env.NEXT_PUBLIC_NIFTIPAY_API_URL}/api/orders`,
          {
            method: "POST",
            headers: {
              "x-api-key": key,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              network: chain,
              asset,
              amount: totalF,
              currency: fiat,
              firstName: client.firstName,
              lastName: client.lastName,
              email: client.email,
              merchantId: activeOrg?.id ?? "",
              reference: data.orderKey,
            }),
          },
        );
        if (!nRes.ok) {
          toast.error("Niftipay invoice failed");
        } else {
          const meta = await nRes.json();
          await fetch(`/api/order/${data.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderMeta: [meta] }),
          });
          toast.success(
            `Niftipay invoice created: send ${fmt(
              meta.order.amount,
            )} ${asset}`,
          );
        }
      }
      cancelOrder();
      router.push(`/orders/${data.id}`);
    } catch (err: any) {
      console.error("createOrder error:", err);
      toast.error(err.message || "Could not create order");
    }
  };

  return (
    <div className="container mx-auto py-6">
      <h1 className="text-3xl font-bold mb-6">Create New Order</h1>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-2 space-y-6">
          {/* Client Selection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" /> Client Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label>Select Client</Label>
                <Select
                  value={selectedClient}
                  onValueChange={(val) => {
                    setSelectedClient(val);
                    const client = clients.find((c) => c.id === val);
                    if (client) setClientCountry(client.country);
                  }}
                  disabled={clientsLoading || orderGenerated}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={
                        clientsLoading ? "Loading…" : "Select a client"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.firstName} {c.lastName} — {c.username} ({c.email})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button
                  onClick={generateOrder}
                  disabled={!selectedClient || orderGenerated}
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
              {orderItems.length > 0 && (
                <div className="space-y-4 mb-4">
                  {orderItems.map(({ product, quantity }, idx) => {
                    const price = product.price;
                    return (
                      <div
                        key={idx}
                        className={
                          "flex items-center gap-4 p-4 border rounded-lg" +
                          (stockErrors[product.id] ? " border-red-500" : "")
                        }
                      >
                        <Image
                          src={product.image}
                          alt={product.title}
                          width={80}
                          height={80}
                          className="rounded-md"
                        />
                        <div className="flex-1">
                          <div className="flex justify-between">
                            <h3 className="font-medium">{product.title}</h3>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeProduct(product.id, idx)}
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
                                updateQuantity(product.id, "subtract")
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="font-medium">{quantity}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => updateQuantity(product.id, "add")}
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
                              $
                              {formatCurrency(
                                product.subtotal ?? price * quantity,
                                clientCountry
                              )}
                            </span>
                          </div>
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

          <Card
            className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" /> Discount Coupon
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label>Coupon Code</Label>
                <Input
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  disabled={couponApplied}
                  placeholder="Enter coupon code"
                />
              </div>
              <div className="flex items-end">
                <Button
                  onClick={applyCoupon}
                  disabled={!couponCode || couponApplied}
                  variant={couponApplied ? "outline" : "default"}
                >
                  {couponApplied ? (
                    <>
                      <Check className="h-4 w-4 mr-2" /> Applied
                    </>
                  ) : (
                    "Apply Coupon"
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Addresses Section */}

          {orderGenerated && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Truck className="h-5 w-5" /> Shipping Address
                </CardTitle>
              </CardHeader>
              <CardContent>
                {addresses.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {addresses.map((addr) => (
                      <label key={addr.id} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="address"
                          className="h-4 w-4"
                          value={addr.id}
                          checked={selectedAddressId === addr.id}
                          onChange={() => setSelectedAddressId(addr.id)}
                        />
                        <span className="font-medium">{addr.address}</span>
                      </label>
                    ))}
                  </div>
                )}

                <Separator className="my-4" />

                <div className="flex gap-4">
                  <div className="flex-1">
                    <Label>Address</Label>
                    <Input
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="123 Main St."
                    />
                  </div>
                  <div className="flex items-end">
                    <Button onClick={addAddress} disabled={!newAddress}>
                      Add Address
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Shipping Section */}

          <Card
            className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}
          >
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
                    disabled={!orderGenerated || shippingLoading}
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
                            {m.title} — {m.description} — ${cost.toFixed(2)}
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
                    disabled={!orderGenerated || shippingLoading}
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

          {/* Payment Methods */}

          <Card
            className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Payment Method
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="payment">Select Payment Method</Label>
              <Select
                value={selectedPaymentMethod}
                onValueChange={setSelectedPaymentMethod}
                disabled={!orderGenerated}
              >
                <SelectTrigger id="payment">
                  <SelectValue placeholder="Select a payment method" />
                </SelectTrigger>
                <SelectContent>
                  {paymentMethods.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* ▼ Niftipay network selector */}
              {paymentMethods.find(
                (p) =>
                  p.id === selectedPaymentMethod &&
                  p.name.toLowerCase() === "niftipay",
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
              {orderGenerated ? (
                <div className="space-y-2">
                  <div className="flex justify-between">
                    <span>Client:</span>
                    <span className="font-medium">
                      {clients.find((c) => c.id === selectedClient)?.email}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Items:</span>
                    <span className="font-medium">{orderItems.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-medium">
                      {formatCurrency(subtotal, clientCountry)}
                    </span>
                  </div>
                  {couponApplied && discount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>
                        Discount
                        {discountType === "percentage" ? ` (${value}%)` : ""}:
                      </span>
                      <span className="font-medium">
                        –{formatCurrency(discount, clientCountry)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Shipping:</span>
                    <span className="font-medium">
                      {formatCurrency(shippingCost, clientCountry)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span>
                      {" "}
                      {formatCurrency(total + shippingCost, clientCountry)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  Select a client and generate an order to see the summary
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button
                onClick={createOrder}
                disabled={
                  !orderGenerated ||
                  orderItems.length === 0 ||
                  !selectedPaymentMethod ||
                  (paymentMethods.find(
                    (p) =>
                      p.id === selectedPaymentMethod &&
                      p.name.toLowerCase() === "niftipay",
                  )
                    ? !selectedNiftipay
                    : false) ||
                  !selectedShippingMethod ||
                  !selectedShippingCompany
                }
                className="w-full"
              >
                Create Order
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
