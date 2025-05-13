"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
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

interface Product {
  id: string;
  title: string;
  sku: string;
  description: string;
  regularPrice: Record<string, number>;
  price: number;
  image: string;
  stockData: Record<string, { [countryCode: string]: number }>;
}

interface OrderItem {
  product: Product;
  quantity: number;
}

interface PaymentMethod {
  id: string;
  name: string;
  details: string;
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

interface Address {
  id: string;
  clientId: string;
  address: string;
  postalCode: string;
  phone: string;
}

interface ShippingCompany {
  id: string;
  name: string;
}

export default function CreateOrderPage() {
  // — Clients
  const [clients, setClients] = useState<
    { id: string; username: string; country: string }[]
  >([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  // — Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  // — Shipping
  const [shippingMethods, setShippingMethods] = useState<ShippingMethod[]>(
    []
  );
  const [shippingCompanies, setShippingCompanies] = useState<
    ShippingCompany[]
  >([]);
  const [shippingLoading, setShippingLoading] = useState(true);
  const [selectedShippingMethod, setSelectedShippingMethod] = useState("");
  const [selectedShippingCompany, setSelectedShippingCompany] = useState("");
  const [shippingCost, setShippingCost] = useState(0);

  // — Payment methods (fetched)
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");

  // — Addresses
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPostalCode, setNewPostalCode] = useState("");
  const [newPhone, setNewPhone] = useState("");

  // — Order
  const [selectedClient, setSelectedClient] = useState("");
  const [clientCountry, setClientCountry] = useState("");
  const [orderGenerated, setOrderGenerated] = useState(false);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [stockErrors, setStockErrors] = useState<Record<string, number>>({});
  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">(
    "fixed"
  );
  const [discount, setDiscount] = useState(0);
  const [value, setValue] = useState(0);
  const [cartId, setCartId] = useState("");

  // — Load clients once
  useEffect(() => {
    setClientsLoading(true);
    fetch("/api/clients/", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch clients");
        return res.json();
      })
      .then(({ clients }) => setClients(clients))
      .catch((err) => toast.error(err.message))
      .finally(() => setClientsLoading(false));
  }, []);

  // — Load products once
  useEffect(() => {
    setProductsLoading(true);
    fetch("/api/products/", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch products");
        return res.json();
      })
      .then(({ products }) => setProducts(products))
      .catch((err) => toast.error(err.message))
      .finally(() => setProductsLoading(false));
  }, []);

  // — Fetch addresses & payment methods whenever a client is selected
  useEffect(() => {
    if (!selectedClient) return;

    // Addresses
    fetch(`/api/clients/${selectedClient}/address`, {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load addresses");
        return res.json();
      })
      .then((data: { addresses: Address[] }) => {
        setAddresses(data.addresses);
        if (data.addresses.length && !selectedAddressId) {
          setSelectedAddressId(data.addresses[0].id);
        }
      })
      .catch((err) => toast.error(err.message));

    // Payment methods
    setPaymentLoading(true);
    fetch("/api/payment-methods", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch payment methods");
        return res.json();
      })
      .then((data: { paymentMethods: PaymentMethod[] }) => {
        setPaymentMethods(data.methods);
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setPaymentLoading(false));
  }, [selectedClient, selectedAddressId]);

  // — Compute subtotal, discount, total
  const subtotal = orderItems.reduce((sum, item) => {
    const price =
      item.product.regularPrice[clientCountry] ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);
  const discountAmount = discount;
  const total = subtotal - discountAmount;

  // — Shipping cost whenever total or method changes
  useEffect(() => {
    if (!selectedShippingMethod) {
      setShippingCost(0);
      return;
    }
    const method = shippingMethods.find((m) => m.id === selectedShippingMethod);
    if (!method) return;
    const tier = method.costs.find(
      ({ minOrderCost, maxOrderCost }) =>
        total >= minOrderCost && (maxOrderCost === 0 || total <= maxOrderCost)
    );
    setShippingCost(tier ? tier.shipmentCost : 0);
  }, [total, selectedShippingMethod, shippingMethods]);

  // — Generate cart & load shipping data
  const generateOrder = async () => {
    if (!selectedClient) return;
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClient }),
      });
      if (!res.ok) throw new Error("Failed to create cart");
      const data = await res.json();
      const { newCart, resultCartProducts } = data;
      setCartId(newCart.id);
      // if the API returned a `rows` array, seed our orderItems from it
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
            },
            quantity: r.quantity,
          }))
        );
      }

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

  // — Update product quantity in cart
  const updateQuantity = async (
    productId: string,
    action: "add" | "subtract",
    qty: number
  ) => {
    if (!cartId) {
      toast.error("Cart hasn’t been created yet!");
      return;
    }
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
      const data = await res.json();
      const newQty = data.quantity;
      setOrderItems((prev) =>
        prev.map((it) =>
          it.product.id === productId ? { ...it, quantity: newQty } : it
        )
      );
    } catch (err: any) {
      toast.error(err.message || "Could not update quantity");
    }
  };

  // — Add or update product
  const addProduct = async () => {
    if (!selectedProduct) return;
    if (!cartId) {
      toast.error("Cart hasn’t been created yet!");
      return;
    }

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
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.message || "Failed to add product");
      }
      const { product: added, quantity: qty } = await res.json();

      setOrderItems((prev) => {
        if (prev.some((it) => it.product.id === added.id)) {
          return prev.map((it) =>
            it.product.id === added.id ? { product: added, quantity: qty } : it
          );
        }
        return [...prev, { product: added, quantity: qty }];
      });

      setSelectedProduct("");
      setQuantity(1);
      toast.success("Product added to cart!");
    } catch (error: any) {
      console.error("addProduct error:", error);
      toast.error(error.message || "Could not add product");
    }
  };

  // — Remove item
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

  // — Add payment method to order
  const [appliedPaymentMethods, setAppliedPaymentMethods] = useState<
    PaymentMethod[]
  >([]);
  const addPaymentMethod = () => {
    const m = paymentMethods.find((m) => m.id === selectedPaymentMethod);
    if (m) setAppliedPaymentMethods((p) => [...p, m]);
    setSelectedPaymentMethod("");
  };
  const removePaymentMethod = (i: number) =>
    setAppliedPaymentMethods((p) => p.filter((_, idx) => idx !== i));

  // — Add a new address
  const addAddress = async () => {
    if (!newAddress || !newPostalCode || !newPhone) {
      return toast.error("All address fields are required");
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
          postalCode: newPostalCode,
          phone: newPhone,
        }),
      });
      if (!res.ok) throw new Error("Failed to save address");
      const created: Address = await res.json();
      setAddresses((prev) => [...prev, created]);
      setSelectedAddressId(created.id);
      setNewAddress("");
      setNewPostalCode("");
      setNewPhone("");
      toast.success("Address added");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

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
    const payment = paymentMethods.find(
      (m) => m.id === selectedPaymentMethod
    )?.name;
    if (!payment) {
      toast.error("Select a payment method");
      return;
    }
    const shippingCompanyName = shippingCompanies.find(
      (c) => c.id === selectedShippingCompany
    )?.name;
    if (!shippingCompanyName) {
      toast.error("Select a shipping company");
      return;
    }
    const addr = addresses.find((a) => a.id === selectedAddressId);
    if (!addr) {
      toast.error("Select a shipping address");
      return;
    }
    const shippingAmount = shippingCost;
    const discountAmount = discount;
    const totalAmount = subtotal - discountAmount + shippingAmount;

    const payload = {
      clientId: selectedClient,
      cartId,
      country: clientCountry,
      paymentMethod: payment,
      shippingAmount,
      discountAmount,
      totalAmount,
      couponCode: couponCode || null,
      shippingCompany: shippingCompanyName,
      address: addr.address,
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
      cancelOrder();
    } catch (err: any) {
      console.error("createOrder error:", err);
      toast.error(err.message || "Could not create order");
    }
  };

  // — Filter products by stock in clientCountry
  const countryProducts = products.filter((p) => {
    const totalStock = Object.values(p.stockData).reduce(
      (sum, e) => sum + (e[clientCountry] || 0),
      0
    );
    return totalStock > 0;
  });

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
                  onValueChange={setSelectedClient}
                  disabled={orderGenerated || clientsLoading}
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
                        {c.username}
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
                              Unit Price: ${price}
                            </span>
                            <span className="font-medium">
                              ${(price * quantity).toFixed(2)}
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
                            {p.title} — ${price.toFixed(2)} — Stock:{" "}
                            {stockCount}
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
              <CardContent className="space-y-6">
                {addresses.length > 0 && (
                  <>
                    <div className="space-y-2">
                      {addresses.map((addr) => (
                        <label
                          key={addr.id}
                          className="flex items-start gap-3 cursor-pointer"
                        >
                          <input
                            type="radio"
                            name="address"
                            className="mt-1"
                            value={addr.id}
                            checked={selectedAddressId === addr.id}
                            onChange={() => setSelectedAddressId(addr.id)}
                          />
                          <div>
                            <p className="font-medium">{addr.address}</p>
                            <p className="text-sm text-muted-foreground">
                              Postal Code: {addr.postalCode} • Phone:{" "}
                              {addr.phone}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                    <Separator />
                  </>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <Label>Address</Label>
                    <Input
                      value={newAddress}
                      onChange={(e) => setNewAddress(e.target.value)}
                      placeholder="123 Main St."
                    />
                  </div>
                  <div>
                    <Label>Postal Code</Label>
                    <Input
                      value={newPostalCode}
                      onChange={(e) => setNewPostalCode(e.target.value)}
                      placeholder="90210"
                    />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input
                      value={newPhone}
                      onChange={(e) => setNewPhone(e.target.value)}
                      placeholder="+1 555-1234"
                    />
                  </div>
                </div>
                <Button
                  onClick={addAddress}
                  disabled={!newAddress || !newPostalCode || !newPhone}
                >
                  Add Address
                </Button>
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
                            {m.title} — {m.description} — $
                            {cost.toFixed(2)}
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
                      {clients.find((c) => c.id === selectedClient)?.username}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Items:</span>
                    <span className="font-medium">{orderItems.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Subtotal:</span>
                    <span className="font-medium">${subtotal.toFixed(2)}</span>
                  </div>
                  {couponApplied && discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>
                        Discount
                        {discountType === "percentage" ? ` (${value}%)` : ""}:
                      </span>
                      <span className="font-medium">–${discount}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span>Shipping:</span>
                    <span className="font-medium">
                      ${shippingCost.toFixed(2)}
                    </span>
                  </div>
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span>${(total + shippingCost).toFixed(2)}</span>
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
                  !selectedShippingMethod ||
                  !selectedShippingCompany
                }
                className="w-full"
              >
                Create Order
              </Button>
              <Button
                variant="outline"
                onClick={cancelOrder}
                disabled={!orderGenerated}
                className="w-full"
              >
                Cancel Order
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
