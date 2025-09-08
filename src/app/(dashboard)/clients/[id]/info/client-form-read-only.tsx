// src/app/(dashboard)/clients/[id]/info/client-form-read-only.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import Link from "next/link";
import Select from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

countriesLib.registerLocale(enLocale);

const countryOptions = Object.entries(countriesLib.getNames("en")).map(
  ([code, name]) => ({
    value: code,
    label: (
      <div className="flex items-center gap-2">
        <ReactCountryFlag countryCode={code} svg style={{ width: 16, height: 16 }} />
        {name}
      </div>
    ),
  }),
);

interface Props {
  clientId: string;
}

type OrderRow = {
  id: string;
  orderKey: string;
  status: "open" | "underpaid" | "pending_payment" | "paid" | "cancelled" | "refunded" | "completed";
  createdAt: string;
  total: number;
  trackingNumber?: string | null;
  shippingCompany?: string | null;
};

export default function ClientDetailView({ clientId }: Props) {
  const router = useRouter();

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: viewPerm, isLoading: viewLoading } =
    useHasPermission(organizationId, { customer: ["view"] });

  const canView = useMemo(() => !viewLoading && viewPerm, [viewLoading, viewPerm]);

  useEffect(() => {
    if (!viewLoading && !viewPerm) router.replace("/clients");
  }, [viewLoading, viewPerm, router]);

  const [client, setClient] = useState<any>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!canView) return;
  
    (async () => {
      try {
        const [clientRes, ordersRes] = await Promise.all([
          fetch(`/api/clients/${clientId}`, {
            headers: {
              "x-internal-secret": process.env.INTERNAL_API_SECRET || "",
            },
          }),
          fetch(
            `/api/order?clientId=${encodeURIComponent(clientId)}&limit=10&fields=id,orderKey,status,createdAt,total,trackingNumber,shippingCompany`,
          ),
        ]);
        if (!clientRes.ok) throw new Error("Failed to fetch client");
        if (!ordersRes.ok) throw new Error("Failed to fetch recent orders");
  
        const clientJson = await clientRes.json();
        setClient(clientJson.client ?? clientJson);   // ← THE FIX
  
        const ordersJson = await ordersRes.json();
        setOrders(ordersJson);
      } catch (err: any) {
        toast.error(err.message || "Error loading client");
        router.replace("/clients");
      } finally {
        setLoading(false);
      }
    })();
  }, [canView, clientId, router]);
  

  if (viewLoading || !canView) return null;
  if (loading) return <p className="p-6">Loading…</p>;
  if (!client) return <p className="p-6">Client not found.</p>;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  const fmtMoney = (n: number) => `$${(n ?? 0).toFixed(2)}`;

  const statusCls = (s: OrderRow["status"]) =>
    ({
      open: "bg-blue-100 text-blue-800",
      paid: "bg-green-100 text-green-800",
      underpaid: "bg-orange-100 text-orange-800",
      pending_payment: "bg-yellow-500",
      cancelled: "bg-red-100 text-red-800",
      refunded: "bg-red-100 text-red-800",
      completed: "bg-purple-100 text-purple-800",
    }[s] ?? "bg-gray-100 text-gray-800");

  /* ---------------------------------------------------------------------- */
  return (
    <div className="max-w-5xl mx-auto py-10 space-y-6">
      {/* Client details (read-only) */}
      <Card>
        <CardHeader>
          <CardTitle>Customer details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Username" value={client.username} />
            <Field label="Email" value={client.email} />
            <Field label="First Name" value={client.firstName} />
            <Field label="Last Name" value={client.lastName} />
            <Field label="Phone Number" value={client.phoneNumber} />
            <div className="flex flex-col">
              <label className="mb-1 text-sm font-medium">Country</label>
              <Select
                options={countryOptions}
                isDisabled
                isClearable
                value={
                  client.country
                    ? countryOptions.find((o) => o.value === client.country) || null
                    : null
                }
              />
            </div>
            <Field label="Referred By" value={client.referredBy || ""} />
          </div>
        </CardContent>
      </Card>

      {/* Recent orders */}
      <Card>
        <CardHeader>
          <CardTitle>Recent orders (last 10)</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.length === 0 ? (
            <p className="text-sm text-muted-foreground">No orders yet.</p>
          ) : (
            <>
              {/* Desktop/tablet */}
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Total</TableHead>
                      <TableHead>Shipping</TableHead>
                      <TableHead>Tracking</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          <Link
                            href={`/orders/${o.id}`}
                            className="underline underline-offset-2 font-medium"
                          >
                            {o.orderKey}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusCls(o.status)}>
                            {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                          </Badge>
                        </TableCell>
                        <TableCell>{fmtDate(o.createdAt)}</TableCell>
                        <TableCell>{fmtMoney(o.total)}</TableCell>
                        <TableCell>{o.shippingCompany ?? "—"}</TableCell>
                        <TableCell>{o.trackingNumber ?? "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile list */}
              <div className="sm:hidden space-y-3">
                {orders.map((o) => (
                  <div key={o.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <Link
                        href={`/orders/${o.id}`}
                        className="underline underline-offset-2 font-medium"
                      >
                        #{o.orderKey}
                      </Link>
                      <Badge variant="outline" className={statusCls(o.status)}>
                        {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {fmtDate(o.createdAt)}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <div className="text-muted-foreground">Total</div>
                        <div>{fmtMoney(o.total)}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">Shipping</div>
                        <div className="truncate">{o.shippingCompany ?? "—"}</div>
                      </div>
                      <div className="col-span-2">
                        <div className="text-muted-foreground">Tracking</div>
                        <div className="truncate">{o.trackingNumber ?? "—"}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* small presenter */
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <label className="mb-1 text-sm font-medium">{label}</label>
      <Input value={value ?? ""} disabled />
    </div>
  );
}
