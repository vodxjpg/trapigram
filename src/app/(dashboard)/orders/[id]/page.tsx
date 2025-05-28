// src/app/(dashboard)/orders/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft, CreditCard, Package, Truck, Send,
} from "lucide-react";
import Image from "next/image";
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";

/* ——————————————————— TYPES ——————————————————— */
interface Product {
  id: string;
  title: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  isAffiliate: boolean;
  image: string | null;
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
  discountValue: number;
  pointsRedeemed?: number;
  pointsRedeemedAmount?: number;
  shipping: number;
  total: number;
  shippingInfo: ShippingInfo;
}
interface Message {
  id: number;
  message: string;
  isInternal: boolean;
  createdAt: Date;
}

/* ——————————————————— HELPERS ——————————————————— */
function groupByProduct(lines: Product[]) {
  return lines.reduce((acc, l) => {
    let bucket = acc.find((b) => b.id === l.id);
    if (!bucket) {
      bucket = {
        id: l.id,
        title: l.title,
        sku: l.sku,
        description: l.description,
        image: l.image,
        isAffiliate: l.isAffiliate,
        priceBuckets: [] as { unitPrice: number; quantity: number }[],
      };
      acc.push(bucket);
    }
    const pb = bucket.priceBuckets.find((p) => p.unitPrice === l.unitPrice);
    if (pb) pb.quantity += l.quantity;
    else bucket.priceBuckets.push({ unitPrice: l.unitPrice, quantity: l.quantity });
    return acc;
  }, [] as Array<{
    id: string;
    title: string;
    sku: string;
    description: string;
    image: string | null;
    isAffiliate: boolean;
    priceBuckets: { unitPrice: number; quantity: number }[];
  }>).map((b) => ({
    ...b,
    // sort buckets so cheapest (usually “old price”) is first
    priceBuckets: [...b.priceBuckets].sort((a, z) => a.unitPrice - z.unitPrice),
  }));
}

export default function OrderView() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");

  /* ————————— fetch order + client ————————— */
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        setLoading(true);
        const orderRes = await fetch(`/api/order/${id}`);
        if (!orderRes.ok) throw new Error("Failed loading order");
        const o: Order = await orderRes.json();

        const clientRes = await fetch(`/api/clients/${o.clientId}`);
        if (!clientRes.ok) throw new Error("Failed loading client");
        const c = await clientRes.json();

        setOrder({
          ...o,
          clientFirstName: c.firstName,
          clientLastName: c.lastName,
          clientEmail: c.email,
          clientUsername: c.username,
        });
        setError(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  /* ————————— fetch messages ————————— */
  useEffect(() => {
    if (!id || !order) return;
    fetch(`/api/order/${id}/messages`)
      .then((r) => r.json())
      .then((d) => setMessages(d.messages))
      .catch(console.error);
  }, [id, order]);

  if (loading) return <div className="container mx-auto py-8 text-center">Loading order…</div>;
  if (error || !order)
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-red-600">Error: {error ?? "Order not found"}</p>
        <Button variant="ghost" className="mt-4" onClick={() => window.history.back()}>
          Go Back
        </Button>
      </div>
    );

  /* ————— derive aggregates ————— */
  const grouped = groupByProduct(order.products);

  const monetarySubtotal = grouped
    .filter((g) => !g.isAffiliate)
    .reduce((sum, g) => sum + g.priceBuckets.reduce((s, pb) => s + pb.unitPrice * pb.quantity, 0), 0);

  const affiliatePointsTotal = grouped
    .filter((g) => g.isAffiliate)
    .reduce((sum, g) => sum + g.priceBuckets.reduce((s, pb) => s + pb.unitPrice * pb.quantity, 0), 0);

  const calculatedTotal =
    monetarySubtotal
    + order.shipping
    - order.discount
    - (order.pointsRedeemedAmount ?? 0);

  /* ————— helpers ————— */
  const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
  const fmtPts   = (n: number) => `${n} pts`;
  const statusClr = (s: string) =>
    ({ open: "bg-blue-500", paid: "bg-green-500", cancelled: "bg-red-500", completed: "bg-purple-500" } as any)[s] ?? "bg-gray-500";
  const fmtMsgTime = (d: Date) => format(d, "MMM d, h:mm a");

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    const res = await fetch(`/api/order/${id}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-is-internal": "true" },
      body: JSON.stringify({ message: newMessage, clientId: order.clientId }),
    });
    const m = await res.json();
    setMessages((prev) => [...prev, { id: m.messages.id, message: m.messages.message, isInternal: m.messages.isInternal, createdAt: m.messages.createdAt }]);
    setNewMessage("");
  };

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Back + title */}
      <div className="mb-6">
        <Button variant="ghost" className="mb-2 flex items-center gap-1 pl-0 hover:bg-transparent" onClick={() => window.history.back()}>
          <ArrowLeft className="h-4 w-4" /> Back to Orders
        </Button>
        <h1 className="text-3xl font-bold">Order Details</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ——— LEFT COLUMN ——— */}
        <div className="lg:col-span-2 space-y-6">

          {/* Order info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                Order Information
                <Badge className={statusClr(order.status)}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Client</p>
                  <p className="font-medium">
                    {order.clientFirstName} {order.clientLastName} — {order.clientUsername} ({order.clientEmail})
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order&nbsp;ID</p>
                  <p className="font-medium">{order.id}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cart&nbsp;ID</p>
                  <p className="font-medium">{order.cartId}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Products */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" /> Products
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
                      <TableHead className="hidden md:table-cell">Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped.map((g) => {
                      const totalQty     = g.priceBuckets.reduce((s, pb) => s + pb.quantity, 0);
                      const cheapest     = g.priceBuckets[0];
                      const lineSubtotal = g.priceBuckets.reduce((s, pb) => s + pb.unitPrice * pb.quantity, 0);

                      return (
                        <TableRow key={g.id}>
                          <TableCell>
                            <div className="h-20 w-20 relative rounded-md overflow-hidden">
                              <Image
                                src={g.image || "/placeholder.svg"}
                                alt={g.title}
                                fill
                                sizes="80px"
                                className="object-cover"
                              />
                            </div>
                          </TableCell>

                          <TableCell className="font-medium">
                            {g.title}
                            {/* price-bucket breakdown */}
                            {g.priceBuckets.length > 1 && (
                              <ul className="text-xs text-muted-foreground mt-1 space-y-[2px]">
                                {g.priceBuckets.map((pb) => (
                                  <li key={pb.unitPrice}>
                                    {pb.quantity} ×{" "}
                                    {g.isAffiliate ? fmtPts(pb.unitPrice) : fmtMoney(pb.unitPrice)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </TableCell>

                          <TableCell>{g.sku}</TableCell>

                          <TableCell className="hidden md:table-cell max-w-xs">
                            <div
                              className="prose max-w-none"
                              dangerouslySetInnerHTML={{ __html: g.description }}
                            />
                          </TableCell>

                          <TableCell className="text-right">{totalQty}</TableCell>

                          <TableCell className="text-right">
                            {g.isAffiliate ? fmtPts(cheapest.unitPrice) : fmtMoney(cheapest.unitPrice)}
                          </TableCell>

                          <TableCell className="text-right">
                            {g.isAffiliate ? fmtPts(lineSubtotal) : fmtMoney(lineSubtotal)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Price summary */}
              <div className="mt-6 space-y-2 border-t pt-4">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>{fmtMoney(monetarySubtotal)}</span>
                </div>
                {affiliatePointsTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Affiliate Items</span>
                    <span className="font-medium">{fmtPts(affiliatePointsTotal)}</span>
                  </div>
                )}
                {order.coupon && (
                  <div className="flex justify-between text-sm">
                    <span>Coupon</span>
                    <span className="font-medium">{order.coupon}</span>
                  </div>
                )}
                {order.discount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{fmtMoney(order.discount)}</span>
                  </div>
                )}
                {order.pointsRedeemed! > 0 && (
                  <div className="flex justify-between text-blue-600">
                    <span>Points Redeemed</span>
                    <span>{fmtPts(order.pointsRedeemed!)}</span>
                  </div>
                )}
                {order.pointsRedeemedAmount! > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Points Discount</span>
                    <span>-{fmtMoney(order.pointsRedeemedAmount!)}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Shipping</span>
                  <span>{fmtMoney(order.shipping)}</span>
                </div>
                <Separator className="my-2" />
                <div className="flex justify-between font-bold text-lg">
                  <span>Total</span>
                  <span>{fmtMoney(calculatedTotal)}</span>
                </div>
                {Math.abs(calculatedTotal - order.total) > 0.01 && (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Server total</span>
                    <span>{fmtMoney(order.total)}</span>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Shipping & payment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" /> Shipping & Payment Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold mb-2">Shipping Address</h3>
                  <p className="text-muted-foreground">{order.shippingInfo.address}</p>
                  <div className="mt-4">
                    <h3 className="font-semibold mb-2">Shipping Company</h3>
                    <p className="text-muted-foreground">{order.shippingInfo.company}</p>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Shipping Method</h3>
                  <p className="text-muted-foreground">{order.shippingInfo.method}</p>
                  <div className="mt-4">
                    <h3 className="font-semibold flex items-center gap-2 mb-2">
                      <CreditCard className="h-4 w-4" /> Payment Method
                    </h3>
                    <p className="text-muted-foreground">{order.shippingInfo.payment}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ——— RIGHT COLUMN ——— */}
        <div className="lg:col-span-1">
          <Card className="h-full flex flex-col">
            <CardHeader>
              <CardTitle>Customer Communication</CardTitle>
              <div className="text-sm text-muted-foreground flex items-center gap-2">
                <span>Client:</span>
                <span className="font-medium">{order.clientEmail}</span>
              </div>
            </CardHeader>
            <CardContent className="flex-grow flex flex-col h-[500px]">
              <ScrollArea className="flex-1">
                <div className="p-2">
                  {messages.map((m) => (
                    <div key={m.id} className={`flex ${m.isInternal ? "justify-end" : "justify-start"}`}>
                      <div className="max-w-[80%]">
                        <div className={`flex items-start gap-2 ${m.isInternal ? "flex-row-reverse" : ""}`}>
                          <Avatar className="mt-1">
                            <AvatarFallback>{m.isInternal ? "A" : order.clientEmail.charAt(0).toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div className={`${m.isInternal ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"} rounded-lg p-3`}>
                            {m.message}
                          </div>
                        </div>
                        <div className="text-xs text-right opacity-70 mt-1">
                          {fmtMsgTime(m.createdAt)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>

              <div className="flex gap-2 mt-2">
                <Input
                  value={newMessage}
                  placeholder="Type a message…"
                  onChange={(e) => setNewMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
                />
                <Button size="icon" onClick={sendMessage}>
                  <Send className="h-4 w-4" />
                  <span className="sr-only">Send</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
