"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, CreditCard, Package, Truck, Send } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import Image from "next/image";
import { format } from "date-fns";

interface Product {
  id: number;
  title: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  image: string;
}

interface ShippingInfo {
  address: string;
  company: string;
  method: string;
  payment: string;
}

interface Order {
  id: string;
  cartId: string;
  clientId: string;
  clientFirstName: string;
  clientLastName: string;
  clientEmail: string;
  clientUsername: string;
  status: string;
  products: Product[];
  subtotal: number;
  coupon?: string;
  discount: number;
  shipping: number;
  total: number;
  shippingInfo: ShippingInfo;
}

interface Message {
  id: number;
  message: string;
  isInternal: true | false;
  createdAt: Date;
}

export default function OrderView() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");

  // Fetch order data
  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`/api/order/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load order ${id}`);
        return res.json();
      })
      .then((data: Order) => {
        setOrder(data);
        setError(null);
      })
      .catch((err: Error) => {
        console.error(err);
        setError(err.message);
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Fetch messages
  useEffect(() => {
    if (!id || !order) return;
    fetch(`/api/order/${id}/messages`)
      .then((res) => res.json())
      .then((data: any[]) => {
        console.log(data.messages);
        setMessages(data.messages);
      })
      .catch(console.error);
  }, [id, order]);

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4 text-center">
        <p>Loading order…</p>
      </div>
    );
  }
  if (error || !order) {
    return (
      <div className="container mx-auto py-8 px-4 text-center">
        <p className="text-red-600">Error: {error ?? "Order not found"}</p>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => window.history.back()}
        >
          Go Back
        </Button>
      </div>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "bg-blue-500";
      case "paid":
        return "bg-green-500";
      case "cancelled":
        return "bg-red-500";
      case "completed":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  const handleSendMessage = async () => {
    if (newMessage.trim() === "") return;

    const res = await fetch(`/api/order/${id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-is-internal": "true",
      },
      body: JSON.stringify({ message: newMessage, clientId: order.clientId }),
    });
    const m = await res.json();
    const sent: Message = {
      id: m.messages.id,
      message: m.messages.message,
      isInternal: m.messages.isInternal,
      createdAt: m.messages.createdAt,
    };
    setMessages((prev) => [...prev, sent]);
    setNewMessage("");
  };

  const formatMessageTime = (date: Date) => {
    return format(date, "MMM d, h:mm a");
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <Button
          variant="ghost"
          className="mb-2 flex items-center gap-1 pl-0 hover:bg-transparent"
          onClick={() => {
            window.history.back();
          }}
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Orders</span>
        </Button>
        <h1 className="text-3xl font-bold">Order Details</h1>
      </div>

      {/* Order Information Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Order Information</span>
                <Badge className={getStatusColor(order.status)}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Client Name</p>
                  <p className="font-medium">
                    {order.clientFirstName} {order.clientLastName} —{" "}
                    {order.clientUsername} ({order.clientEmail})
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order ID</p>
                  <p className="font-medium">{order.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cart ID</p>
                  <p className="font-medium">{order.cartId}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products Section */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                <span>Products</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Image</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead className="hidden md:table-cell">
                        Description
                      </TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {order.products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="h-20 w-20 relative rounded-md overflow-hidden">
                            <Image
                              src={product.image || "/placeholder.svg"}
                              alt={product.title}
                              fill
                              className="object-cover"
                              sizes="80px"
                            />
                          </div>
                        </TableCell>
                        <TableCell className="font-medium">
                          {product.title}
                        </TableCell>
                        <TableCell>{product.sku}</TableCell>
                        <TableCell className="hidden md:table-cell max-w-xs">
                          <div
                            className="prose max-w-none"
                            dangerouslySetInnerHTML={{
                              __html: product.description,
                            }}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          {product.quantity}
                        </TableCell>
                        <TableCell className="text-right">
                          ${product.unitPrice.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right">
                          ${(product.unitPrice * product.quantity).toFixed(2)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-6 space-y-2 border-t pt-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>${order.subtotal.toFixed(2)}</span>
                </div>

                {order.coupon && (
                  <div className="flex justify-between text-sm">
                    <span>Coupon Applied</span>
                    <span className="font-medium">{order.coupon}</span>
                  </div>
                )}

                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-${order.discount.toFixed(2)}</span>
                  </div>
                )}

                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>${order.shipping.toFixed(2)}</span>
                </div>

                <Separator className="my-2" />

                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>${order.total.toFixed(2)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Shipping Information Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" />
                <span>Shipping & Payment Information</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Shipping Address</h3>
                  <p className="text-muted-foreground">
                    {order.shippingInfo.address}
                  </p>

                  <div className="mt-4">
                    <h3 className="font-semibold mb-2">Shipping Company</h3>
                    <p className="text-muted-foreground">
                      {order.shippingInfo.company}
                    </p>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Shipping Method</h3>
                  <p className="text-muted-foreground">
                    {order.shippingInfo.method}
                  </p>

                  <div className="mt-4">
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4" />
                      <span>Payment Method</span>
                    </h3>
                    <p className="text-muted-foreground">
                      {order.shippingInfo.payment}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        {/* Chat Section - Right Side */}
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Customer Communication</span>
              </CardTitle>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span>Client:</span>
                <span className="font-medium">{order.clientEmail}</span>
                <span className="text-xs">({order.clientEmail})</span>
              </div>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col h-[500px]">
              <ScrollArea className="flex-1 overflow-auto">
                <div className="p-2">
                  {messages.map((message, index) => (
                    <div
                      key={index}
                      className={`flex ${message.isInternal === false ? "justify-start" : "justify-end"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${message.isInternal === false ? "flex-row" : "flex-row-reverse"}`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <Avatar
                            className={
                              message.isInternal === false ? "mt-1" : "mt-1"
                            }
                          >
                            <AvatarFallback>
                              {message.isInternal === false
                                ? order.clientEmail.charAt(0).toUpperCase()
                                : "A"}
                            </AvatarFallback>
                          </Avatar>
                          <div
                            className={`rounded-lg p-3 ${
                              message.isInternal === false
                                ? "bg-muted text-foreground"
                                : "bg-primary text-primary-foreground"
                            }`}
                          >
                            <p>{message.message}</p>
                          </div>
                        </div>
                        <div className="text-xs mt-1 text-right opacity-70">
                          {formatMessageTime(message.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex gap-2 mt-auto">
                <Input
                  placeholder="Type a message..."
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                />
                <Button onClick={handleSendMessage} size="icon">
                  <Send className="h-4 w-4" />
                  <span className="sr-only">Send message</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
