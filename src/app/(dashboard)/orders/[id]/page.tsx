"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, CreditCard, Package, Truck, Send,
  Eye, EyeOff, MessageSquarePlus, Trash, Loader2
} from "lucide-react";
import Image from "next/image";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import { Label } from "@/components/ui/label";


interface Product {
  id: string;
  title: string;
  sku: string;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal?: number;             // backend sends 'subtotal'
  isAffiliate: boolean;
  supplierOrgId?: string | null;
  supplierName?: string | null;
  image: string | null;
  variationId?: string | null;   // <-- keep rows distinct by variation
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
  dropshipperOrgId?: string | null;
  dropshipperName?: string | null;
}
interface Message {
  id: string;
  message: string;
  isInternal: boolean;
  createdAt: Date;
}

// ───────────────────────── NOTES ─────────────────────────
interface OrderNote {
  id: string;
  orderId: string;
  organizationId: string;
  authorRole: "client" | "staff";
  authorClientId: string | null;
  authorUserId: string | null;
  note: string;
  visibleToCustomer: boolean;
  createdAt: string;
  updatedAt: string;
}

function parsePaymentUri(u?: string): { scheme?: string; address?: string } {
  if (!u || typeof u !== "string") return {};
  const idx = u.indexOf(":");
  if (idx <= 0) return {};
  const scheme = u.slice(0, idx);
  const rest = u.slice(idx + 1);
  const q = rest.indexOf("?");
  const address = q >= 0 ? rest.slice(0, q) : rest;
  return { scheme, address };
}

function parseCrypto(metaArr: any[]) {
  if (!Array.isArray(metaArr) || metaArr.length === 0) return null;

  // 1) Latest status/event (fallback to order.status if present)
  let latestStatus: string = "pending";
  for (let i = metaArr.length - 1; i >= 0; i--) {
    const item = metaArr[i];
    const ev = item?.event ?? item?.status ?? item?.order?.status;
    if (typeof ev === "string" && ev.length) {
      latestStatus = ev;
      break;
    }
  }

  // 2) Find the most recent entry that actually has an address
  let address: string | null = null;
  let addrSnap: any | null = null;
  for (let i = metaArr.length - 1; i >= 0; i--) {
    const o = (metaArr[i] && (metaArr[i].order ?? metaArr[i])) || null;
    if (!o) continue;
    const uri = typeof o.paymentUri === "string" ? o.paymentUri : undefined;
    const parsed = parsePaymentUri(uri);
    const candidate = o.address || o.depositAddress || parsed.address || null;
    if (candidate) {
      address = String(candidate);
      addrSnap = o;
      break;
    }
  }
  if (!addrSnap) return null; // nothing to show

  // 3) Backfill other fields from newest available info
  // Preferred sources: addrSnap → otherwise newest item that has the field
  const pickNewest = <T,>(pick: (o: any) => T | undefined): T | undefined => {
    for (let i = metaArr.length - 1; i >= 0; i--) {
      const o = (metaArr[i] && (metaArr[i].order ?? metaArr[i])) || null;
      const v = o ? pick(o) : undefined;
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };

  const uriFromSnap = typeof addrSnap.paymentUri === "string" ? addrSnap.paymentUri : undefined;
  const schemeFromSnap = parsePaymentUri(uriFromSnap).scheme;

  const network =
    addrSnap.network ||
    addrSnap.chain ||
    schemeFromSnap ||
    pickNewest<string | undefined>((o) => o.network || o.chain) ||
    null;

  const asset =
    addrSnap.asset ??
    pickNewest<string | undefined>((o) => o.asset) ??
    undefined;

  const qrUrl =
    addrSnap.qrUrl ??
    pickNewest<string | undefined>((o) => o.qrUrl) ??
    undefined;

  const expectedRaw =
    addrSnap.expected ?? addrSnap.amount ?? pickNewest<number | string | undefined>((o) => o.expected ?? o.amount);
  const receivedRaw =
    addrSnap.received ?? pickNewest<number | string | undefined>((o) => o.received);

  const expected = Number(expectedRaw || 0) || 0;
  const received = Number(receivedRaw || 0) || 0;

  return {
    asset,
    network,
    address,
    qrUrl,
    expected,
    received,
    pending: Math.max(0, expected - received),
    status: latestStatus,
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

  // IMPORTANT: never call hooks conditionally. Optional-chaining here
  // could skip the hook on the first render and run it later, breaking
  // the Rules of Hooks and freezing the page. Always call it.
  const { data: session } = authClient.useSession();
  const currentUserId: string | null = session?.user?.id ?? null;

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

  // keep notes tied to order:view (read) and order:update (write) if you have it in your system
  const { hasPermission: canEditOrder } = useHasPermission(organizationId, { order: ["update"] });
  const canUseNotes = canViewOrder; // read allowed with view; create/toggle gated below by canEditOrder

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const lastSeen = useRef<string | null>(null);

  // Notes state
  const [notes, setNotes] = useState<OrderNote[]>([]);
  const [notesLoading, setNotesLoading] = useState<boolean>(true);
  const [notesScope, setNotesScope] = useState<"staff" | "customer">("staff");
  const [newNote, setNewNote] = useState<string>("");
  const [newNotePublic, setNewNotePublic] = useState<boolean>(false);
  const [creatingNote, setCreatingNote] = useState<boolean>(false);

  const fetchNotes = useCallback(async () => {
    if (!id || !canUseNotes) return;
    setNotesLoading(true);
    try {
      const res = await fetch(`/api/order/${id}/notes?scope=${notesScope}`);
      if (!res.ok) throw new Error("Failed loading notes");
      const data = await res.json();
      setNotes(Array.isArray(data.notes) ? data.notes : []);
    } catch (e) {
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  }, [id, canUseNotes, notesScope]);

  const createNote = async () => {
    if (!order || !newNote.trim() || !canEditOrder) return;
    if (!currentUserId) return; // cannot attribute author on server schema
    setCreatingNote(true);
    try {
      const res = await fetch(`/api/order/${order.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          note: newNote,
          visibleToCustomer: newNotePublic,
          authorRole: "staff",
          authorUserId: currentUserId,
        }),
      });
      if (!res.ok) throw new Error("Failed creating note");
      setNewNote("");
      setNewNotePublic(false);
      await fetchNotes();
    } catch (e) {
      // ignore toast for now to keep diff focused
    } finally {
      setCreatingNote(false);
    }
  };

  const toggleNoteVisibility = async (noteId: string, visible: boolean) => {
    if (!canEditOrder) return;
    await fetch(`/api/order-notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visibleToCustomer: visible }),
    });
    await fetchNotes();
  };

  const deleteNote = async (noteId: string) => {
    if (!canEditOrder) return;
    await fetch(`/api/order-notes/${noteId}`, { method: "DELETE" });
    await fetchNotes();
  };

  const fetchOrderAndClient = async () => {
    if (!id) return;
    try {
      setLoading(true);
      const orderRes = await fetch(`/api/order/${id}`);
      if (!orderRes.ok) throw new Error("Failed loading order");
      const o: Order = await orderRes.json();
      console.log(o)

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
        dropshipperOrgId: (o as any).dropshipperOrgId ?? null,
        dropshipperName: (o as any).dropshipperName ?? null,
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
    let pusher: any | null = null;
    let channel: any | null = null;
    let cancelled = false;

    fetchMessages(); // initial back-fill

    (async () => {
      const mod = await import("pusher-js");                // ★ dynamic import
      if (cancelled) return;
      const Pusher = mod.default;
      pusher = new Pusher("6f9adcf7a6b2d8780aa9", {
        cluster: "eu",
      });
      channel = pusher.subscribe(`order-${id}`);
      channel.bind("new-message", (msg: any) => {
        setMessages((prev) =>
          prev.some((m) => m.id === msg.id)
            ? prev
            : [...prev, { ...msg, createdAt: new Date(msg.createdAt) }],
        );
        lastSeen.current = msg.createdAt;
      });
    })();

    const poll = setInterval(fetchMessages, 60_000);
    return () => {
      cancelled = true;
      channel?.unbind_all();
      if (pusher && channel) pusher.unsubscribe(`order-${id}`);
      pusher?.disconnect();
      clearInterval(poll);
    };
  }, [id, canViewChat, fetchMessages]);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);


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

  // No grouping — use the server lines directly
  const lines = order.products;

  // Monetary subtotal only for non-affiliate items
  const monetarySubtotal = lines
    .filter(l => !l.isAffiliate)
    .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  // Points total for affiliate items (if you show it)
  const affiliatePointsTotal = lines
    .filter(l => l.isAffiliate)
    .reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);

  const calculatedTotal =
    monetarySubtotal + order.shipping - order.discount - (order.pointsRedeemedAmount ?? 0);

  const keyOf = (l: Product) => `${l.id}:${l.variationId ?? "base"}`;

  const fmtMoney = (n: number) => formatCurrency(n, order.country);
  const fmtPts = (n: number) => `${n} pts`;
  // Safer, typed status color map (no self-referential keyof)
  const STATUS_COLORS = {
    open: "bg-blue-500",
    paid: "bg-green-500",
    pending_payment: "bg-yellow-500",
    cancelled: "bg-red-500",
    completed: "bg-purple-500",
  } as const;
  const statusClr = (s: string) =>
    (STATUS_COLORS as Record<string, string>)[s] ?? "bg-gray-500";
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
                  <p className="text-sm text-muted-foreground">Dropshipper</p>
                  <p className="font-medium">
                    {order.dropshipperName ?? "—"}
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
                    {lines.map((l, idx) => (
                      <TableRow key={`${keyOf(l)}:${l.variationId ?? "base"}:${l.sku}:${idx}`}>
                        <TableCell>
                          <div className="h-20 w-20 relative rounded-md overflow-hidden">
                            <Image
                              src={l.image || "/placeholder.svg"}
                              alt={l.title}
                              fill
                              sizes="80px"
                              className="object-cover"
                            />
                          </div>
                        </TableCell>

                        <TableCell className="font-medium">
                          {l.title}
                          {!l.isAffiliate && l.supplierName && (
                            <div className="text-xs text-muted-foreground mt-0.5">
                              Supplier: {l.supplierName}
                            </div>
                          )}
                        </TableCell>

                        <TableCell>{l.sku}</TableCell>

                        <TableCell className="hidden md:table-cell max-w-xs">
                          {(() => {
                            const clean = stripHtml(l.description);
                            const short = truncate(clean, 8);
                            return <span title={clean}>{short}</span>;
                          })()}
                        </TableCell>

                        <TableCell className="text-right">{l.quantity}</TableCell>

                        {canViewPricing && (
                          <TableCell className="text-right">
                            {l.isAffiliate ? fmtPts(l.unitPrice) : fmtMoney(l.unitPrice)}
                          </TableCell>
                        )}

                        {canViewPricing && (
                          <TableCell className="text-right">
                            {l.isAffiliate
                              ? fmtPts(l.unitPrice * l.quantity)
                              : fmtMoney(l.unitPrice * l.quantity)}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
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
                  <p className="whitespace-pre-line break-words">{order.shippingInfo.address}</p>
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

        <div className="xl:col-span-1 space-y-6">
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
          {/* ───────────────────────── ORDER NOTES ───────────────────────── */}
          <Card className="h-[560px] flex flex-col">
            <CardHeader className="flex-shrink-0 pb-3">
              <CardTitle className="flex items-center gap-2">
                <MessageSquarePlus className="h-5 w-5" />
                Order Notes
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 flex flex-col min-h-0 px-0">
              {/* controls under the title so the title stands alone */}
              <div className="px-4 pb-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Button
                      variant={notesScope === "staff" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNotesScope("staff")}
                    >
                      Staff view
                    </Button>
                    <Button
                      variant={notesScope === "customer" ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNotesScope("customer")}
                    >
                      Customer view
                    </Button>
                  </div>
                </div>
                <div className="text-sm text-muted-foreground mt-2">
                  Notes are encrypted. Public notes are visible to the customer.
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <ScrollArea className="h-full px-4">
                  <div className="px-1 py-3 space-y-3">
                    {notesLoading ? (
                      <div className="flex items-center justify-center py-10 text-muted-foreground">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Loading notes…
                      </div>
                    ) : notes.length === 0 ? (
                      <div className="text-center text-muted-foreground py-10">
                        No notes yet.
                      </div>
                    ) : (
                      notes.map((n) => (
                        <div key={n.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">
                                {n.authorRole === "staff" ? "Staff" : "Client"}
                              </Badge>
                              <Badge className={n.visibleToCustomer ? "bg-green-600" : "bg-gray-500"}>
                                {n.visibleToCustomer ? "Customer-visible" : "Staff-only"}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              {canEditOrder && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => toggleNoteVisibility(n.id, !n.visibleToCustomer)}
                                  title={n.visibleToCustomer ? "Make staff-only" : "Make public"}
                                >
                                  {n.visibleToCustomer ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                </Button>
                              )}
                              {canEditOrder && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={() => deleteNote(n.id)}
                                  title="Delete note"
                                >
                                  <Trash className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="mt-2 text-sm whitespace-pre-wrap">{n.note}</p>
                          <div className="mt-2 text-xs text-muted-foreground">
                            {format(new Date(n.createdAt), "MMM d, h:mm a")}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
              </div>
              {canEditOrder && (
                <div className="flex-shrink-0 p-4 border-t bg-background space-y-3">
                  <Textarea
                    value={newNote}
                    placeholder="Add a note…"
                    onChange={(e) => setNewNote(e.target.value)}
                  />
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch id="public-note" checked={newNotePublic} onCheckedChange={setNewNotePublic} />
                      <Label htmlFor="public-note" className="text-sm">
                        Visible to customer
                      </Label>
                    </div>
                    <Button onClick={createNote} disabled={!newNote.trim() || creatingNote || !currentUserId}>
                      {creatingNote && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                      Add Note
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}