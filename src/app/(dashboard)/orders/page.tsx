"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import {
  CreditCard,
  Package,
  Plus,
  Trash2,
  User,
  Check,
  Tag,
  DollarSign,
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
  regularPrice: Record<string, number>; // e.g. { CL: 10, VE: 8 }
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

const PAYMENT_METHODS: PaymentMethod[] = [
  { id: "1", name: "Credit Card", details: "Visa, Mastercard, American Express" },
  { id: "2", name: "Bank Transfer", details: "Direct bank transfer" },
  { id: "3", name: "PayPal", details: "Online payment system" },
];

export default function CreateOrderPage() {
  // Clients
  const [clients, setClients] = useState<{ id: string; username: string; country: string }[]>([]);
  const [clientsLoading, setClientsLoading] = useState(true);

  // Products
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  // Order state
  const [selectedClient, setSelectedClient] = useState("");
  const [clientCountry, setClientCountry] = useState("");
  const [orderGenerated, setOrderGenerated] = useState(false);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [selectedProduct, setSelectedProduct] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [couponCode, setCouponCode] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [discountType, setDiscountType] = useState<"percentage" | "fixed">("fixed");
  const [discount, setDiscount] = useState(0);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("");
  const [appliedPaymentMethods, setAppliedPaymentMethods] = useState<PaymentMethod[]>([]);
  const [cartId, setCartId] = useState("");
  const [cartQtyMap, setCartQtyMap] = useState<Record<string, number>>({});

  // Load clients once
  useEffect(() => {
    async function loadClients() {
      setClientsLoading(true);
      try {
        const res = await fetch("/api/clients/", {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
        });
        if (!res.ok) throw new Error("Failed to fetch clients");
        const { clients } = await res.json();
        setClients(clients);
      } catch (err: any) {
        toast.error(err.message || "Could not load clients");
      } finally {
        setClientsLoading(false);
      }
    }
    loadClients();
  }, []);

  // Load products once
  async function loadProducts() {
    setProductsLoading(true);
    try {
      const res = await fetch("/api/products/", {
        headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
      });
      if (!res.ok) throw new Error("Failed to fetch products");
      const { products } = await res.json();
      setProducts(products);
    } catch (err: any) {
      toast.error(err.message || "Could not load products");
    } finally {
      setProductsLoading(false);
    }
  }
  useEffect(() => {
    loadProducts();
  }, []);

  // Compute totals
  const subtotal = orderItems.reduce((sum, item) => {
    const price = item.product.regularPrice[clientCountry] ?? item.product.price;
    return sum + price * item.quantity;
  }, 0);
  const discountAmount = discountType === "percentage" ? (subtotal * discount) / 100 : discount;
  const total = subtotal - discountAmount;

  // Generate cart + capture clientCountry
  const generateOrder = async () => {
    if (!selectedClient) return;
    try {
      const res = await fetch("/api/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: selectedClient }),
      });
      if (!res.ok) throw new Error("Failed to create cart");
      const { id } = await res.json();
      setCartId(id);
      const client = clients.find((c) => c.id === selectedClient);
      if (client) setClientCountry(client.country);
      toast.success("Cart created!");
      setOrderGenerated(true);
    } catch (err: any) {
      toast.error(err.message || "Could not generate order");
    }
  };

  // Filter products by country stock > 0
  const countryProducts = products.filter((p) => {
    const totalStock = Object.values(p.stockData).reduce(
      (sum, e) => sum + (e[clientCountry] || 0),
      0
    );
    return totalStock > 0;
  });

  // Add or update product in order
  const addProduct = async () => {
    if (!selectedProduct || !cartId) {
      !cartId && toast.error("Generate your cart first!");
      return;
    }
    const product = products.find((p) => p.id === selectedProduct);
    if (!product) return;
    const price = product.regularPrice[clientCountry] ?? product.price;

    try {
      // send to server
      const res = await fetch(`/api/cart/${cartId}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: selectedProduct, quantity, price }),
      });
      if (!res.ok) throw new Error("Failed to add product");
      const { product: added, quantity: qtyAdded } = await res.json();

      setOrderItems((prev) => {
        const idx = prev.findIndex((it) => it.product.id === added.id);
        if (idx >= 0) {
          // already in list → update qty
          const updated = [...prev];
          updated[idx] = {
            product: added,
            quantity: qtyAdded,
          };
          return updated;
        } else {
          // new entry
          return [...prev, { product: added, quantity: qtyAdded }];
        }
      });

      await loadProducts();
      setSelectedProduct("");
      setQuantity(1);
      toast.success("Product added to cart!");
    } catch (err: any) {
      toast.error(err.message || "Could not add product");
    }
  };

  // Remove an item completely
  const removeItem = (idx: number) =>
    setOrderItems((prev) => prev.filter((_, i) => i !== idx));

  // Apply coupon
  const applyCoupon = async () => {
    if (!couponCode || !cartId) {
      toast.error("Generate your cart first and enter a coupon");
      return;
    }
    try {
      const res = await fetch(`/api/cart/${cartId}/apply-coupon`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: couponCode }),
      });
      if (!res.ok) throw new Error("Failed to apply coupon");
      const { discountAmount: amt, discountType: type } = await res.json();
      setDiscount(amt);
      setDiscountType(type);
      setCouponApplied(true);
      toast.success("Coupon applied!");
    } catch (err: any) {
      toast.error(err.message || "Could not apply coupon");
    }
  };

  // Payment methods
  const addPaymentMethod = () => {
    const m = PAYMENT_METHODS.find((m) => m.id === selectedPaymentMethod);
    if (m) setAppliedPaymentMethods((p) => [...p, m]);
    setSelectedPaymentMethod("");
  };
  const removePaymentMethod = (i: number) =>
    setAppliedPaymentMethods((p) => p.filter((_, idx) => idx !== i));

  // Cancel / Create
  const cancelOrder = () => {
    setSelectedClient("");
    setOrderGenerated(false);
    setOrderItems([]);
    setCouponCode("");
    setCouponApplied(false);
    setDiscount(0);
    setSelectedPaymentMethod("");
    setAppliedPaymentMethods([]);
    setClientCountry("");
  };
  const createOrder = () => {
    alert("Order created successfully!");
    cancelOrder();
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
                <Label htmlFor="client">Select Client</Label>
                <Select
                  value={selectedClient}
                  onValueChange={setSelectedClient}
                  disabled={orderGenerated || clientsLoading}
                >
                  <SelectTrigger id="client">
                    <SelectValue
                      placeholder={clientsLoading ? "Loading…" : "Select a client"}
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
          <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Product Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Already added */}
              {orderItems.length > 0 && (
                <div className="space-y-4 mb-4">
                  {orderItems.map(({ product, quantity }, idx) => {
                    const price = product.regularPrice[clientCountry] ?? product.price;
                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-4 p-4 border rounded-lg"
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
                            <Button variant="ghost" size="icon" onClick={() => removeItem(idx)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          <p className="text-sm text-muted-foreground">SKU: {product.sku}</p>
                          <div
                            className="text-sm"
                            dangerouslySetInnerHTML={{ __html: product.description }}
                          />
                          <div className="flex justify-between mt-2">
                            <div>
                              <span className="font-medium">Unit Price: ${price.toFixed(2)}</span>{" "}
                              × <span className="font-medium">{quantity}</span>
                            </div>
                            <span className="font-medium">${(price * quantity).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Select new product + qty */}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="product">Select Product</Label>
                  <Select
                    value={selectedProduct}
                    onValueChange={setSelectedProduct}
                    disabled={productsLoading}
                  >
                    <SelectTrigger id="product">
                      <SelectValue
                        placeholder={productsLoading ? "Loading…" : "Select a product"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {countryProducts.map((p) => {
                        const price = p.regularPrice[clientCountry];
                        return (
                          <SelectItem key={p.id} value={p.id}>
                            {p.title} — ${price.toFixed(2)}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                <div className="w-24">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    min={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
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
          <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" /> Discount Coupon
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <Label htmlFor="coupon">Coupon Code</Label>
                <Input
                  id="coupon"
                  value={couponCode}
                  onChange={(e) => setCouponCode(e.target.value)}
                  disabled={couponApplied}
                  placeholder="Enter coupon code"
                />
              </div>
              <div className="flex items-end">
                <Button onClick={applyCoupon} disabled={!couponCode || couponApplied} variant={couponApplied ? "outline" : "default"}>
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

          {/* Payment Methods */}
          <Card className={!orderGenerated ? "opacity-50 pointer-events-none" : ""}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" /> Payment Methods
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {appliedPaymentMethods.map((m, idx) => (
                <div key={idx} className="flex justify-between items-center p-4 border rounded-lg">
                  <div>
                    <h3 className="font-medium">{m.name}</h3>
                    <p className="text-sm text-muted-foreground">{m.details}</p>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removePaymentMethod(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <div className="flex flex-col sm:flex-row gap-4">
                <div className="flex-1">
                  <Label htmlFor="payment">Select Payment Method</Label>
                  <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
                    <SelectTrigger id="payment">
                      <SelectValue placeholder="Select payment method" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end">
                  <Button onClick={addPaymentMethod} disabled={!selectedPaymentMethod}>
                    <Plus className="h-4 w-4 mr-2" /> Add Payment
                  </Button>
                </div>
              </div>
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
                        Discount{discountType === "percentage" ? ` (${discount}%)` : ""}:
                      </span>
                      <span className="font-medium">–${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between text-lg font-bold">
                    <span>Total:</span>
                    <span>${total.toFixed(2)}</span>
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
                disabled={!orderGenerated || orderItems.length === 0 || appliedPaymentMethods.length === 0}
                className="w-full"
              >
                Create Order
              </Button>
              <Button variant="outline" onClick={cancelOrder} disabled={!orderGenerated} className="w-full">
                Cancel Order
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
