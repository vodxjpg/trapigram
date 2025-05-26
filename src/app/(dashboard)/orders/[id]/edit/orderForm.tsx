// src/app/(dashboard)/orders/[id]/edit/orderForm.tsx
"use client";

import React, { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
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
}
interface ShippingMethod {
  id: string;
  title: string;
  description: string;
  costs: Array<{ minOrderCost: number; maxOrderCost: number; shipmentCost: number }>;
}
interface ShippingCompany {
  id: string;
  name: string;
}

export default function OrderFormVisual({ orderId }: OrderFormWithFetchProps) {
  const router = useRouter();

  /* ——————————————————— STATE ——————————————————— */
  const [orderData, setOrderData] = useState<any | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [subtotal, setSubtotal] = useState(0);
  const [total, setTotal]       = useState(0);
  const [clientCountry, setClientCountry] = useState("");
  const [cartId, setCartId] = useState("");

  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});

  const [productsLoading, setProductsLoading] = useState(true);
  const [products, setProducts]       = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity]       = useState(1);

  const [addresses, setAddresses]     = useState<{ id: string; address: string }[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [newAddress, setNewAddress]   = useState("");

  const [showNewCoupon, setShowNewCoupon] = useState(false);
  const [newCoupon, setNewCoupon]     = useState("");

  const [couponApplied, setCouponApplied] = useState(false);
  const [couponCode, setCouponCode]       = useState("");

  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("fixed");
  const [discount, setDiscount]         = useState<number>(0);   // ← number, never null
  const [value, setValue]               = useState<number>(0);   // ← “

  const [shippingLoading, setShippingLoading] = useState(true);
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>([]);
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>([]);
  const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
  const [selectedShippingMethod, setSelectedShippingMethod]   = useState("");

  /* ——————————————————— HELPERS ——————————————————— */
  const calcRowSubtotal = (p: Product, qty: number) =>
    (p.regularPrice[clientCountry] ?? p.price) * qty;

  /* ——————————————————— EFFECTS ——————————————————— */
  useEffect(() => {
    const sum = orderItems.reduce(
      (acc, item) => acc + (item.product.subtotal ?? calcRowSubtotal(item.product, item.quantity)),
      0
    );
    setSubtotal(sum);
  }, [orderItems, clientCountry]);

  // total recalculation
  useEffect(() => {
    if (!orderData) return;
    const shipping      = orderData.shipping ?? 0;
    const baseDiscount  = couponApplied ? discount : orderData.discount ?? 0;
    const dType         = couponApplied ? discountType : orderData.discountType;
    setDiscountType(dType);
    setDiscount(Number(baseDiscount));
    setTotal(subtotal + shipping - Number(baseDiscount));
  }, [subtotal, orderData?.shipping, orderData?.discount, orderData?.discountType,
      couponApplied, discountType]);

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

        const addrRes  = await fetch(`/api/clients/${data.clientId}/address`);
        const addrData = await addrRes.json();
        setAddresses(addrData.addresses);

        const match = addrData.addresses.find((a: any) => a.address === data.shippingInfo.address);
        if (match) setSelectedAddressId(match.id);
      } catch {
        toast.error("Failed to load order or addresses");
      }
    })();
  }, [orderId]);

  /* ——————————————————— FETCH CART ITEMS ——————————————————— */
  useEffect(() => {
    if (!cartId) return;
    (async () => {
      try {
        const res = await fetch(`/api/cart/${cartId}`, { headers: { "Content-Type": "application/json" } });
        const { resultCartProducts } = await res.json();
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
        toast.success("Order Loaded!");
      } catch (err: any) {
        toast.error(err.message);
      }
    })();
  }, [cartId]);

  /* ——————————————————— LOAD STATIC DATA ——————————————————— */
  useEffect(() => {
    loadProducts();
    loadShipping();
  }, []);

  async function loadProducts() {
    setProductsLoading(true);
    try {
      const res = await fetch("/api/products", { headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET! }});
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
    action: "add" | "subtract",
    qty: number
  ) => {
    if (!cartId) return toast.error("Cart hasn’t been created yet!");
    try {
      const res = await fetch(`/api/cart/${cartId}/update-product`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, action, quantity: qty }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to update quantity");
      }
      const { product, quantity } = await res.json();
      const subtotalRow = calcRowSubtotal(product, quantity);

      setOrderItems((prev) =>
        prev.map((it) =>
          it.product.id === product.id
            ? { product: { ...product, subtotal: subtotalRow }, quantity }
            : it
        )
      );
    } catch (err: any) {
      toast.error(err.message || "Could not update qu|antity");
    }
  };

  // New: update order
  const handleUpdateOrder = async () => {
    if (!orderData?.id) return;
    try {
      const selectedAddressText = addresses.find(
        (a) => a.id === selectedAddressId
      )?.address;
      const res = await fetch(`/api/order/${orderData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discount: discount ? Number(discount) : orderData.discount,
          couponCode: newCoupon ? newCoupon : orderData.coupon,
          address: selectedAddressText,
          total,
          selectedShippingMethod,
          selectedShippingCompany,
        }),
      });
      if (!res.ok) throw new Error("Failed to update order");
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
          <Card>
            <CardHeader>
              <CardTitle>Client</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-lg font-medium">
                {orderData?.client?.firstName} {orderData?.client?.lastName} —{" "}
                {orderData?.client?.username} ({orderData?.client?.email})
              </p>
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
                  {orderItems.map(({ product, quantity }, idx) => {
                    const price =
                      product.regularPrice[clientCountry] ?? product.price;
                    return (
                      <div
                        key={idx}
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
                          <div className="w-20 h-20 bg-gray-100 rounded-md flex items-center justify-center text-gray-500">
                            No image
                          </div>
                        )}
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
                                updateQuantity(product.id, "subtract", quantity)
                              }
                            >
                              <Minus className="h-4 w-4" />
                            </Button>
                            <span className="font-medium">{quantity}</span>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                updateQuantity(product.id, "add", quantity)
                              }
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
                              Unit Price: ${price.toFixed(2)}
                            </span>
                            <span className="font-medium">
                              $
                              {product.subtotal.toFixed(2) ??
                                calcRowSubtotal(product, quantity)}
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
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Payment Method
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Label htmlFor="payment">Select Payment Method</Label>
              <p className="text-lg font-medium">
                {orderData?.shippingInfo.payment}
              </p>
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
                    {orderData?.products.length}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Subtotal:</span>
                  <span className="font-medium">${subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-green-600">
                  <span>
                    Discount
                    {discountType === "percentage"
                      ? ` (${value.toFixed(2)}%)`
                      : ""}
                    :
                  </span>
                  <span className="font-medium">–${discount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Shipping:</span>
                  <span className="font-medium">
                    ${orderData?.shipping.toFixed(2)}
                  </span>
                </div>
                <Separator />
                <div className="flex justify-between text-lg font-bold">
                  <span>Total:</span>
                  <span>${total.toFixed(2)}</span>
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
