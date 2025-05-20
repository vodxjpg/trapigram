// components/OrderFormVisual.tsx
"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  CreditCard,
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
import { Label } from "@/components/ui/label";

interface OrderFormWithFetchProps {
  orderId?: string;
}

export default function OrderFormVisual({ orderId }: OrderFormWithFetchProps) {
  const router = useRouter();
  const [orderData, setOrderData] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!orderId) return;
    setLoading(true);
    fetch(`/api/order/${orderId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch order");
        return res.json();
      })
      .then((data) => {
        console.log(data);
        setOrderData(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [orderId]);

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
                {orderData?.clientFirstName} {orderData?.clientLastName} —{" "}
                {orderData?.clientUserName} ({orderData?.clientEmail})
              </p>
            </CardContent>
          </Card>

          {/* Product Selection */}
          <Card>
            <CardHeader>
              <CardTitle>Product Selection</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {orderData?.products && orderData?.products.length > 0 ? (
                orderData.products.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start gap-4 p-4 border rounded-lg"
                  >
                    <Image
                      src={item.image}
                      alt={item.title}
                      width={80}
                      height={80}
                      className="rounded-md"
                    />
                    <div className="flex-1">
                      <div className="flex justify-between items-center">
                        <h3 className="font-medium">{item.title}</h3>
                        <Button size="icon" variant="ghost">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        SKU: {item.sku}
                      </p>
                      <p
                        className="text-sm mt-2"
                        dangerouslySetInnerHTML={{
                          __html: item.description,
                        }}
                      ></p>
                      <div className="flex items-center gap-2 mt-4">
                        <Button size="icon" variant="ghost">
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="font-medium">{item.quantity}</span>
                        <Button size="icon" variant="ghost">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                      <div className="flex justify-between mt-4">
                        <span>Unit Price: ${item.unitPrice.toFixed(2)}</span>
                        <span className="font-medium">
                          ${(item.unitPrice * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground">
                  No products in this order
                </p>
              )}
            </CardContent>
          </Card>

          {/* Discount Coupon */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Tag className="h-5 w-5" /> Discount Coupon
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <p className="text-lg font-medium">{orderData?.coupon || "—"}</p>
            </CardContent>
          </Card>

          {/* Shipping Address */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" /> Shipping Address
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4">
              <p className="text-lg font-medium">
                {orderData?.shippingInfo.address}
              </p>
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
                <div>
                  <Label>Method</Label>
                  <p className="text-lg font-medium">
                    {orderData?.shippingInfo.method}
                  </p>
                </div>
                <div>
                  <Label>Company</Label>
                  <p className="text-lg font-medium">
                    {orderData?.shippingInfo.company}
                  </p>
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
              <div className="text-center py-6 text-muted-foreground">
                Summary will appear here
              </div>
            </CardContent>
            <CardFooter className="flex flex-col gap-3">
              <Button className="w-full">Update Order</Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
