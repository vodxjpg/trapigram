// src/app/(dashboard)/clients/[id]/info/client-form-read-only.tsx
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
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
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RefreshCcw, Zap, ShieldAlert, ShieldOff, ChevronLeft, ChevronRight, Clock } from "lucide-react";

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
  status:
  | "open"
  | "underpaid"
  | "pending_payment"
  | "paid"
  | "cancelled"
  | "refunded"
  | "completed";
  createdAt: string;
  total: number;
  trackingNumber?: string | null;
  shippingCompany?: string | null;
};

type SecretMeta = {
  hasPhrase: boolean;
  updatedAt: string | null; // ISO string or null
};

/* ==================== Affiliate Logs (client-scoped, 10 rows/page) ==================== */
type Log = {
  id: string;
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description: string | null;
  sourceClientId: string | null;
  createdAt: string;
  clientLabel?: string;
  sourceClientLabel?: string;
};

function ClientAffiliateLogs({ clientId }: { clientId: string }) {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const fallbackId = (id: string | null | undefined) =>
    id ? id.slice(0, 8) + "…" : "-";

  const loadLogs = async () => {
    setLoading(true);
    try {
      const url = new URL(`/api/affiliate/points`, window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      url.searchParams.set("clientId", clientId); // server-side filter

      const r = await fetch(url.toString(), {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
      });
      if (!r.ok) throw new Error((await r.json()).error || "Fetch failed");
      const { logs, totalPages, currentPage } = await r.json();

      // Safety: ensure only this client's logs render
      const scoped = (Array.isArray(logs) ? logs : []).filter(
        (l: Log) => l.clientId === clientId
      );

      setLogs(scoped);
      setTotalPages(totalPages ?? 1);
      setPage(currentPage ?? page);
    } catch (e: any) {
      toast.error(e.message || "Failed to load affiliate logs");
      setLogs([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1); // reset if client changes
  }, [clientId]);

  useEffect(() => {
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, clientId]);

  return (
    <Card className="p-4">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Δ Points</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Source Client</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  Loading logs…
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center">
                  No logs
                </TableCell>
              </TableRow>
            ) : (
              logs.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs">
                    {l.id.slice(0, 8)}…
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-4 w-4 opacity-70" />
                      {new Date(l.createdAt).toLocaleString()}
                    </div>
                  </TableCell>
                  <TableCell className={l.points >= 0 ? "text-green-600" : "text-red-600"}>
                    {l.points > 0 ? "+" : ""}
                    {l.points}
                  </TableCell>
                  <TableCell>{l.action}</TableCell>
                  <TableCell>{l.description ?? "-"}</TableCell>
                  <TableCell>
                    {l.sourceClientId ? (
                      <Link href={`/clients/${l.sourceClientId}/info`}>
                        {l.sourceClientLabel || fallbackId(l.sourceClientId)}
                      </Link>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage(1)}
            disabled={page === 1 || loading}
            aria-label="First page"
          >
            <ChevronLeft className="h-4 w-4" />
            <ChevronLeft className="h-4 w-4 -ml-2" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages || loading}
            aria-label="Last page"
          >
            <ChevronRight className="h-4 w-4" />
            <ChevronRight className="h-4 w-4 -ml-2" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* ==================== end: Affiliate Logs ==================== */

export default function ClientDetailView({ clientId }: Props) {
  const router = useRouter();

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: viewPerm, isLoading: viewLoading } =
    useHasPermission(organizationId, { customer: ["view"] });
  const { hasPermission: updatePerm } =
    useHasPermission(organizationId, { customer: ["update"] });

  const canView = useMemo(() => !viewLoading && viewPerm, [viewLoading, viewPerm]);
  const canUpdate = !!updatePerm;

  useEffect(() => {
    if (!viewLoading && !viewPerm) router.replace("/clients");
  }, [viewLoading, viewPerm, router]);

  const [client, setClient] = useState<any>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Secret-phrase UI bits
  const [secretEnabled, setSecretEnabled] = useState<boolean | null>(null);
  const [secretMeta, setSecretMeta] = useState<SecretMeta | null>(null);
  const [loadingSecret, setLoadingSecret] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [togglingEnabled, setTogglingEnabled] = useState(false);
  const [resetting, setResetting] = useState(false);

  const fmtDate = (iso?: string | null) =>
    iso
      ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
      : "—";

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

  // Load client & recent orders
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
            `/api/order?clientId=${encodeURIComponent(
              clientId,
            )}&limit=10&fields=id,orderKey,status,createdAt,total,trackingNumber,shippingCompany`,
          ),
        ]);
        if (!clientRes.ok) throw new Error("Failed to fetch client");
        if (!ordersRes.ok) throw new Error("Failed to fetch recent orders");

        const clientJson = await clientRes.json();
        const c = clientJson.client ?? clientJson; // API may wrap
        setClient(c);

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

  // Secret phrase info
  const refreshSecretInfo = useCallback(async () => {
    if (!client?.userId) return;
    setLoadingSecret(true);
    try {
      const sRes = await fetch(
        `/api/clients/secret-phrase/${encodeURIComponent(client.userId)}/settings`,
      );
      if (sRes.ok) {
        const sJson = await sRes.json();
        setSecretEnabled(!!sJson.enabled);
      } else {
        setSecretEnabled(null);
      }

      let meta: SecretMeta | null = null;
      try {
        const mRes = await fetch(`/api/clients/secret-phrase/${encodeURIComponent(client.userId)}/meta`);
        if (mRes.ok) {
          const m = await mRes.json();
          meta = { hasPhrase: !!m.hasPhrase, updatedAt: m.updatedAt ?? null };
        }
      } catch { /* noop */ }

      if (!meta) {
        try {
          const gRes = await fetch(`/api/clients/secret-phrase/${encodeURIComponent(client.userId)}`);
          if (gRes.ok) {
            const g = await gRes.json();
            meta = { hasPhrase: !!g.hasPhrase, updatedAt: g.updatedAt ?? null };
          }
        } catch { /* noop */ }
      }

      if (!meta) {
        const hasViaClient =
          typeof client.hasSecretPhrase === "boolean" ||
          typeof client.secretPhraseUpdatedAt === "string";
        meta = hasViaClient
          ? {
            hasPhrase: !!client.hasSecretPhrase || !!client.secretPhraseUpdatedAt,
            updatedAt: client.secretPhraseUpdatedAt ?? null,
          }
          : { hasPhrase: false, updatedAt: null };
      }

      setSecretMeta(meta);
    } catch (e: any) {
      console.warn("Failed to load secret-phrase info:", e?.message || e);
    } finally {
      setLoadingSecret(false);
    }
  }, [client?.userId, client?.hasSecretPhrase, client?.secretPhraseUpdatedAt]);

  useEffect(() => {
    refreshSecretInfo();
  }, [refreshSecretInfo]);

  const handleForceNow = async () => {
    if (!client?.userId) return;
    setForcing(true);
    try {
      const res = await fetch(
        `/api/clients/secret-phrase/${encodeURIComponent(client.userId)}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ forceNow: true }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to force secret phrase");
      }
      toast.success("Secret phrase challenge forced for this client.");
      await refreshSecretInfo();
    } catch (e: any) {
      toast.error(e?.message || "Failed to force secret phrase");
    } finally {
      setForcing(false);
    }
  };

  const handleToggleEnabled = async () => {
    if (!client?.userId || secretEnabled === null) return;
    setTogglingEnabled(true);
    try {
      const res = await fetch(
        `/api/clients/secret-phrase/${encodeURIComponent(client.userId)}/settings`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !secretEnabled }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to update setting");
      }
      toast.success(
        !secretEnabled
          ? "Secret phrase enabled for this client."
          : "Secret phrase disabled for this client.",
      );
      await refreshSecretInfo();
    } catch (e: any) {
      toast.error(e?.message || "Failed to update setting");
    } finally {
      setTogglingEnabled(false);
    }
  };

  const handleResetPhrase = async () => {
    if (!client?.userId) return;
    if (
      !window.confirm(
        "Reset secret phrase for this customer?\n\nThis clears the current phrase. Next time they use the bot, they’ll be asked to set a new one.",
      )
    ) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(
        `/api/clients/secret-phrase/${encodeURIComponent(client.userId)}`,
        { method: "DELETE" },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Failed to reset secret phrase");
      }
      toast.success("Secret phrase cleared for this customer.");
      await refreshSecretInfo();
    } catch (e: any) {
      toast.error(e?.message || "Failed to reset secret phrase");
    } finally {
      setResetting(false);
    }
  };

  if (viewLoading || !canView) return null;
  if (loading) return <p className="p-6">Loading…</p>;
  if (!client) return <p className="p-6">Client not found.</p>;

  /* ---------------------------------------------------------------------- */
  return (
    <div className="container mx-auto p-6 space-y-6">
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

      {/* Secret phrase block (per-client) */}
      <Card>
        <CardHeader>
          <CardTitle>Security — Secret Phrase</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-4">
            <KV label="Enabled for this client">
              {loadingSecret ? (
                <span className="text-muted-foreground">Loading…</span>
              ) : secretEnabled === null ? (
                <span className="text-muted-foreground">Unknown</span>
              ) : secretEnabled ? (
                <Badge className="bg-green-600 text-white">Enabled</Badge>
              ) : (
                <Badge variant="outline" className="border-gray-300 text-gray-700">
                  Disabled
                </Badge>
              )}
            </KV>

            <KV label="Has secret phrase">
              {loadingSecret ? (
                <span className="text-muted-foreground">Loading…</span>
              ) : secretMeta?.hasPhrase ? (
                <Badge className="bg-blue-600 text-white">Yes</Badge>
              ) : (
                <Badge variant="outline" className="border-gray-300 text-gray-700">
                  No
                </Badge>
              )}
            </KV>

            <KV label="Last set on">{fmtDate(secretMeta?.updatedAt)}</KV>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={refreshSecretInfo} variant="outline" disabled={loadingSecret}>
              <RefreshCcw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button
              onClick={handleForceNow}
              disabled={forcing || !canUpdate}
              title={!canUpdate ? "You don't have permission to update customers" : ""}
            >
              <Zap className="h-4 w-4 mr-2" />
              {forcing ? "Forcing…" : "Force secret phrase now"}
            </Button>
            <Button
              onClick={handleToggleEnabled}
              variant="outline"
              disabled={togglingEnabled || !canUpdate || secretEnabled === null}
              title={!canUpdate ? "You don't have permission to update customers" : ""}
            >
              <ShieldOff className="h-4 w-4 mr-2" />
              {secretEnabled
                ? togglingEnabled
                  ? "Disabling…"
                  : "Disable for this client"
                : togglingEnabled
                  ? "Enabling…"
                  : "Enable for this client"}
            </Button>
            <Button
              onClick={handleResetPhrase}
              variant="destructive"
              disabled={resetting || !canUpdate}
              title={!canUpdate ? "You don't have permission to update customers" : ""}
            >
              <ShieldAlert className="h-4 w-4 mr-2" />
              {resetting ? "Resetting…" : "Reset (clear) secret phrase"}
            </Button>
          </div>

          {!canUpdate && (
            <p className="text-xs text-muted-foreground">
              You don't have permission to update this client.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Activity: Orders + Affiliate Logs (tabs) */}
      <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="orders" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="orders" className="w-full">Recent orders (last 10)</TabsTrigger>
              <TabsTrigger value="affiliate" className="w-full">Affiliate log</TabsTrigger>
            </TabsList>

            <TabsContent value="orders">
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
            </TabsContent>

            <TabsContent value="affiliate">
              <ClientAffiliateLogs clientId={clientId} />
            </TabsContent>
          </Tabs>
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

function KV({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="mb-1 text-sm font-medium">{label}</div>
      <div>{children}</div>
    </div>
  );
}
