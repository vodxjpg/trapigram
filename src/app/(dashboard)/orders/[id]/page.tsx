"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Pusher from "pusher-js";                          // ★ NEW
import { ArrowLeft, CreditCard, Package, Truck, Send } from "lucide-react";
import Image from "next/image";
import { format } from "date-fns";
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
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";
import { formatCurrency } from "@/lib/currency";


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
  orderKey: string;
  orderMeta: any[];
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
  country?: string;
}
interface Message {
  id: string;
  message: string;
  isInternal: boolean;
  createdAt: Date;
}

function groupByProduct(lines: Product[]) {
  return lines
    .reduce((acc, l) => {
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
    }>)
    .map((b) => ({
      ...b,
      priceBuckets: [...b.priceBuckets].sort((a, z) => a.unitPrice - z.unitPrice),
    }));
}

function parseCrypto(metaArr: any[]) {
  if (!metaArr?.length) return null;
  const last = metaArr[metaArr.length - 1];
  const o = last.order ?? last;
  const ev = last.event ?? last.status ?? "pending";
  const expected = Number(o.expected ?? o.amount) || 0;
  const received = Number(o.received ?? 0) || 0;
  return {
    asset: o.asset,
    network: o.network,
    address: o.address,
    qrUrl: o.qrUrl,
    expected,
    received,
    pending: Math.max(0, expected - received),
    status: ev,
  };
}

const stripHtml = (html?: string) =>
  (html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

const truncate = (text: string, max = 8) =>
  text.length <= max ? text : text.slice(0, max) + "...";


export default function OrderView() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canViewOrder, isLoading: permLoading } =
    useHasPermission(organizationId, { order: ["view"] });
  const { hasPermission: canViewPricing } = useHasPermission(
    organizationId,
    { order: ["view_pricing"] },
  );
  const { hasPermission: canViewChat } = useHasPermission(
    organizationId,
    { orderChat: ["view"] },
  );

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const lastSeen = useRef<string | null>(null);

  const fetchOrderAndClient = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const orderRes = await fetch(`/api/order/${id}`);
      if (!orderRes.ok) throw new Error("Failed loading order");
      const o: Order = await orderRes.json();

      const clientRes = await fetch(`/api/clients/${o.clientId}`);
      if (!clientRes.ok) throw new Error("Failed loading client");
      const { client: c } = await clientRes.json();

      setOrder({
        ...o,
        orderKey: o.orderKey,
        orderMeta: o.orderMeta ?? [],
        clientFirstName: c.firstName ?? "",
        clientLastName: c.lastName ?? "",
        clientEmail: c.email ?? "",
        clientUsername: c.username,
        discountValue: o.discountValue,
      });
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchMessages = useCallback(async () => {
    if (!id || !canViewChat) return;
    const qs = lastSeen.current ? `?since=${encodeURIComponent(lastSeen.current)}` : "";
    const res = await fetch(`/api/order/${id}/messages${qs}`);
    if (!res.ok) return;
    const { messages: fresh } = await res.json();
    if (!fresh.length) return;
    setMessages((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      const newer = fresh
        .filter((m: any) => !seen.has(m.id))
        .map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) }));
      if (!newer.length) return prev;
      lastSeen.current = fresh[fresh.length - 1].createdAt;
      return [...prev, ...newer];
    });
  }, [id, canViewChat]);

  const sendMessage = async () => {
    if (!newMessage.trim()) return;
    await fetch(`/api/order/${id}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-is-internal": "true",
      },
      body: JSON.stringify({ message: newMessage, clientId: order!.clientId }),
    });
    setNewMessage("");
  };

  useEffect(() => {
    if (!permLoading && !canViewOrder) router.replace("/dashboard");
  }, [permLoading, canViewOrder, router]);

  useEffect(() => {
    fetchOrderAndClient();
  }, [id]);

  useEffect(() => {
    if (!canViewChat) return;

    fetchMessages();                               // initial back‑fill

    const pusher = new Pusher("6f9adcf7a6b2d8780aa9", {
      cluster: "eu",
      channelAuthorization: { transport: "ajax" }, // no‑op (public channel)
    });
    const channel = pusher.subscribe(`order-${id}`);

    channel.bind("new-message", (msg: any) => {
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id)
          ? prev
          : [...prev, { ...msg, createdAt: new Date(msg.createdAt) }],
      );
      lastSeen.current = msg.createdAt;
    });

    /* backup poll every 60 s */
    const poll = setInterval(fetchMessages, 60_000);

    return () => {
      channel.unbind_all();
      pusher.unsubscribe(`order-${id}`);
      pusher.disconnect();
      clearInterval(poll);
    };
  }, [id, canViewChat, fetchMessages]);



  if (permLoading) return null;
  if (loading)
    return <div className="container mx-auto py-8 text-center">Loading order…</div>;
  if (error || !order)
    return (
      <div className="container mx-auto py-8 text-center">
        <p className="text-red-600">Error: {error ?? "Order not found"}</p>
        <Button variant="ghost" className="mt-4" onClick={() => window.history.back()}>
          Go Back
        </Button>
      </div>
    );

  const grouped = groupByProduct(order.products);

  const monetarySubtotal = grouped
    .filter((g) => !g.isAffiliate)
    .reduce(
      (sum, g) =>
        sum + g.priceBuckets.reduce((s, pb) => s + pb.unitPrice * pb.quantity, 0),
      0,
    );

  const affiliatePointsTotal = grouped
    .filter((g) => g.isAffiliate)
    .reduce(
      (sum, g) =>
        sum + g.priceBuckets.reduce((s, pb) => s + pb.unitPrice * pb.quantity, 0),
      0,
    );

  const calculatedTotal =
    monetarySubtotal + order.shipping - order.discount - (order.pointsRedeemedAmount ?? 0);

  const fmtMoney = (n: number) => formatCurrency(n, order.country);
  const fmtPts = (n: number) => `${n} pts`;
  const statusClr = (s: string) =>
    (
      {
        open: "bg-blue-500",
        paid: "bg-green-500",
        cancelled: "bg-red-500",
        completed: "bg-purple-500",
      } as const
    )[s as keyof typeof statusClr] ?? "bg-gray-500";
  const crypto = parseCrypto(order.orderMeta);

  const fmtMsgTime = (d: Date) => format(d, "MMM d, h:mm a");

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <div className="mb-6">
        <Button
          variant="ghost"
          className="mb-2 flex items-center gap-1 pl-0 hover:bg-transparent"
          onClick={() => window.history.back()}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Orders
        </Button>
        <h1 className="text-3xl font-bold">Order Details</h1>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
        <div className="xl:col-span-3 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex justify-between">
                Order Information
                <Badge className={statusClr(order.status)}>
                  {order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Client</p>
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
                  <p className="text-sm text-muted-foreground">Order number</p>
                  <p className="font-medium">{order.orderKey}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Cart ID</p>
                  <p className="font-medium">{order.cartId}</p>
                </div>
              </div>
            </CardContent>
          </Card>

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
                      <TableHead className="hidden md:table-cell">
                        Description
                      </TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      {canViewPricing && (
                        <TableHead className="text-right">Unit Price</TableHead>
                      )}
                      {canViewPricing && (
                        <TableHead className="text-right">Total</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {grouped.map((g) => {
                      const qty = g.priceBuckets.reduce(
                        (s, pb) => s + pb.quantity,
                        0,
                      );
                      const cheapest = g.priceBuckets[0];
                      const sub = g.priceBuckets.reduce(
                        (s, pb) => s + pb.unitPrice * pb.quantity,
                        0,
                      );
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
                            {g.priceBuckets.length > 1 && (
                              <ul className="text-xs text-muted-foreground mt-1 space-y-1">
                                {g.priceBuckets.map((pb) => (
                                  <li key={pb.unitPrice}>
                                    {pb.quantity} ×{" "}
                                    {g.isAffiliate
                                      ? fmtPts(pb.unitPrice)
                                      : fmtMoney(pb.unitPrice)}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </TableCell>
                          <TableCell>{g.sku}</TableCell>
                          <TableCell className="hidden md:table-cell max-w-xs">
                            {(() => {
                              const clean = stripHtml(g.description);
                              const short = truncate(clean, 8);
                              return (
                                <span title={clean}>
                                  {short}
                                </span>
                              );
                            })()}
                          </TableCell>

                          <TableCell className="text-right">{qty}</TableCell>
                          {canViewPricing && (
                            <TableCell className="text-right">
                              {g.isAffiliate
                                ? fmtPts(cheapest.unitPrice)
                                : fmtMoney(cheapest.unitPrice)}
                            </TableCell>
                          )}
                          {canViewPricing && (
                            <TableCell className="text-right">
                              {g.isAffiliate ? fmtPts(sub) : fmtMoney(sub)}
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {canViewPricing && (
                <div className="mt-6 border-t pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span>Subtotal</span>
                    <span>{fmtMoney(monetarySubtotal)}</span>
                  </div>
                  {affiliatePointsTotal > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Affiliate Items</span>
                      <span>{fmtPts(affiliatePointsTotal)}</span>
                    </div>
                  )}
                  {order.coupon && (
                    <div className="flex justify-between text-sm">
                      <span>Coupon</span>
                      <span>{order.coupon}</span>
                    </div>
                  )}
                  {order.discount > 0 && (
                    <div className="flex justify-between text-red-600">
                      <span>Discount</span>
                      <span>-{fmtMoney(order.discount)}</span>
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
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5" /> Shipping & Payment Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h3 className="font-semibold">Shipping Address</h3>
                  <p>{order.shippingInfo.address}</p>
                  <h3 className="font-semibold mt-4">Shipping Company</h3>
                  <p>{order.shippingInfo.company}</p>
                </div>
                <div>
                  <h3 className="font-semibold">Shipping Method</h3>
                  <p>{order.shippingInfo.method}</p>
                  <h3 className="font-semibold mt-4 flex items-center gap-2">
                    <CreditCard className="h-4 w-4" /> Payment Method
                  </h3>
                  <p>{order.shippingInfo.payment}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {crypto && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5" /> Crypto Payment
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Network / Asset</p>
                    <p className="font-medium">
                      {crypto.network} / {crypto.asset}
                    </p>

                    <p className="text-sm text-muted-foreground mt-4">
                      Wallet&nbsp;Address
                    </p>
                    <p className="font-mono break-all">{crypto.address}</p>
                  </div>
                  <div className="flex flex-col items-center">
                    <div className="w-40 h-40 relative">
                      <img
                        src={crypto.qrUrl}
                        alt={`QR for ${crypto.asset}`}
                        className="w-40 h-40 object-contain rounded-md border"
                      />
                    </div>
                    <div className="mt-4 space-y-1 text-center">
                      <p className="text-sm">
                        Expected:{" "}
                        <span className="font-medium">{crypto.expected}</span>
                      </p>
                      {crypto.status === "underpaid" && (
                        <>
                          <p className="text-sm text-red-600">
                            Received: {crypto.received}
                          </p>
                          <p className="text-sm text-red-600 font-semibold">
                            Pending: {crypto.pending}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="xl:col-span-1">
          <Card className="h-[800px] flex flex-col">
            <CardHeader className="flex-shrink-0 pb-4">
              <CardTitle>Customer Communication</CardTitle>
              <div className="text-sm text-muted-foreground">
                Client: {order.clientEmail}
              </div>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 p-0">
              {canViewChat ? (
                <>
                  <div className="flex-1 min-h-0">
                    <ScrollArea className="h-full">
                      <div className="px-4 py-2 space-y-4">
                        {messages.length === 0 ? (
                          <div className="text-center text-muted-foreground py-8">
                            <p>No messages yet</p>
                            <p className="text-sm">Start a conversation</p>
                          </div>
                        ) : (
                          messages.map((m) => (
                            <div
                              key={m.id}
                              className={`flex ${m.isInternal ? "justify-end" : "justify-start"
                                } mb-4`}
                            >
                              <div className="max-w-[85%] flex flex-col">
                                <div
                                  className={`flex items-start gap-2 ${m.isInternal
                                      ? "flex-row-reverse"
                                      : "flex-row"
                                    }`}
                                >
                                  <Avatar className="w-8 h-8 flex-shrink-0">
                                    <AvatarFallback className="text-xs">
                                      {m.isInternal
                                        ? "A"
                                        : order.clientEmail
                                          .charAt(0)
                                          .toUpperCase()}
                                    </AvatarFallback>
                                  </Avatar>
                                  <div
                                    className={`rounded-lg p-3 break-words ${m.isInternal
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-muted text-foreground"
                                      }`}
                                  >
                                    <p className="text-sm">{m.message}</p>
                                  </div>
                                </div>
                                <div
                                  className={`text-xs text-muted-foreground mt-1 ${m.isInternal ? "text-right" : "text-left"
                                    }`}
                                >
                                  {fmtMsgTime(m.createdAt)}
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </div>
                  <div className="flex-shrink-0 p-4 border-t bg-background">
                    <div className="flex gap-2">
                      <Input
                        value={newMessage}
                        placeholder="Type a message…"
                        onChange={(e) => setNewMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                        className="flex-1"
                      />
                      <Button
                        size="icon"
                        onClick={sendMessage}
                        disabled={!newMessage.trim() || !canViewChat}
                      >
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center p-4">
                  <p className="text-muted-foreground text-center">
                    You don't have permission to view customer communication.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}