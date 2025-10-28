// src/app/(dashboard)/clients/clients-table.tsx
"use client";

import {
  useState,
  useEffect,
  useCallback,
  startTransition,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Edit,
  MoreVertical,
  Search,
  Trash2,
  Plus,
  Minus,
} from "lucide-react";
import Link from "next/link";
import { useDebounce } from "@/hooks/use-debounce";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import en from "i18n-iso-countries/langs/en.json";
import { toast } from "sonner";

// ⬇️ TanStack + shared table
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

countriesLib.registerLocale(en);

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Client = {
  id: string;
  organizationId: string;
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  country: string | null;
  referredBy: string | null;
  points: number;
};

type Stats = {
  totalOrders: number;
  mostPurchased: string;
  quantityPurchased: number;
  lastPurchase: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function ClientsTable() {
  const router = useRouter();

  /* ── permissions ──────────────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { customer: ["view"] }
  );
  const { hasPermission: canCreate } = useHasPermission(orgId, { customer: ["create"] });
  const { hasPermission: canUpdate } = useHasPermission(orgId, { customer: ["update"] });
  const { hasPermission: canDelete } = useHasPermission(orgId, { customer: ["delete"] });
  const { hasPermission: canPoints } = useHasPermission(orgId, { affiliates: ["points"] });

  /* ── state ─────────────────────────────────────────────────────── */
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalPages, setTotalPages] = useState(1);

  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 400);

  const [statsOpen, setStatsOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData, setStatsData] = useState<Stats | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [delta, setDelta] = useState("");              // amount (non-negative)
  const [sign, setSign] = useState<"add" | "subtract">("add"); // sign selector
  const [saving, setSaving] = useState(false);

  /* ── helpers ───────────────────────────────────────────────────── */
  const formatDate = (d: string | Date) => {
    const date = new Date(d);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  };

  /* ── data fetch ────────────────────────────────────────────────── */
  const fetchClients = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients?page=${page}&pageSize=${pageSize}&search=${debounced}`,
        {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        }
      );
      if (!res.ok) throw new Error((await res.json()).error || "Fetch failed");

      const { clients, totalPages, currentPage } = await res.json();
      setClients(clients);
      setTotalPages(totalPages);
      setPage(currentPage);

      // merge affiliate balances
      const balRes = await fetch("/api/affiliate/points/balance", {
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
      });
      const { balances } = await balRes.json();

      setClients((prev) =>
        prev.map((c) => ({
          ...c,
          points:
            balances.find((b: any) => b.clientId === c.id)?.pointsCurrent ?? 0,
        }))
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!viewLoading) fetchClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLoading, page, pageSize, debounced]);

  /* ── stats modal ───────────────────────────────────────────────── */
  const openStatsModal = useCallback(async (id: string) => {
    setStatsOpen(true);
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/clients/${id}`);
      const data = await res.json();
      setStatsData({
        totalOrders: data.totalOrders,
        mostPurchased: data.mostPurchased,
        quantityPurchased: data.quantityPurchased,
        lastPurchase: data.lastPurchase.createdAt,
      });
    } catch (err: any) {
      err.message = "This client doesn't have any stats";
      toast.error(err.message);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  /* ── delete client ─────────────────────────────────────────────── */
  const deleteClient = async (id: string) => {
    if (!canDelete || !confirm("Delete this client?")) return;
    await fetch(`/api/clients/${id}`, {
      method: "DELETE",
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
      },
    });
    fetchClients();
  };

  /* ── adjust points ─────────────────────────────────────────────── */
  const openAdjustDialog = (client: Client) => {
    if (!canPoints) return;
    setSelected(client);
    setDelta("");
    setSign("add");
    setDialogOpen(true);
  };

  const saveAdjustment = async () => {
    // Mobile-friendly: we only accept non-negative input, apply sign from UI
    const raw = Number(delta);
    const absInt = Number.isFinite(raw) ? Math.floor(Math.abs(raw)) : NaN;

    if (!selected || !Number.isFinite(absInt) || absInt === 0) {
      toast.error("Enter a non-zero integer amount");
      return;
    }

    const signed = sign === "subtract" ? -absInt : absInt;
    setSaving(true);
    try {
      await fetch("/api/affiliate/points", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify({
          id: selected.id,
          points: signed,
          action: signed > 0 ? "MANUAL_ADD" : "MANUAL_SUBTRACT",
          description: "Dashboard manual adjustment",
        }),
      });
      toast.success("Points updated");
      setDialogOpen(false);
      // Optional: refresh the table in place; keep your redirect behavior:
      // await fetchClients();
      router.push("/affiliates");
    } catch (err: any) {
      toast.error(err.message || "Failed to update points");
    } finally {
      setSaving(false);
    }
  };

  /* ── columns + table (UNCONDITIONAL) ───────────────────────────── */
  const columns = useMemo<ColumnDef<Client>[]>(() => [
    {
      accessorKey: "username",
      header: "Username",
      cell: ({ row }) => (
        <Link
          href={`/clients/${row.original.id}/info`}
          className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-ring rounded-sm"
        >
          {row.original.username}
        </Link>
      ),
    },
    {
      id: "fullName",
      header: "Name",
      cell: ({ row }) => `${row.original.firstName} ${row.original.lastName}`,
    },
    { accessorKey: "email", header: "Email" },
    { accessorKey: "phoneNumber", header: "Phone" },
    {
      accessorKey: "country",
      header: "Country",
      cell: ({ row }) => {
        const code = row.original.country;
        if (!code) return <span>-</span>;
        return (
          <div className="flex items-center">
            <ReactCountryFlag
              countryCode={code}
              svg
              style={{ width: "1em", height: "1em", marginRight: 6 }}
            />
            {countriesLib.getName(code, "en") ?? code}
          </div>
        );
      },
    },
    { accessorKey: "points", header: "Points" },
    {
      accessorKey: "referredBy",
      header: "Ref.",
      cell: ({ row }) => row.original.referredBy ?? "-",
    },
    {
      id: "stats",
      header: "Stats",
      cell: ({ row }) => (
        <Button variant="ghost" size="icon" onClick={() => openStatsModal(row.original.id)}>
          <Search className="h-4 w-4" />
        </Button>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canPoints && (
                <DropdownMenuItem onClick={() => openAdjustDialog(c)}>
                  <DollarSign className="mr-2 h-4 w-4" /> Adjust Points
                </DropdownMenuItem>
              )}
              {canUpdate && (
                <DropdownMenuItem onClick={() => router.push(`/clients/${c.id}`)}>
                  <Edit className="mr-2 h-4 w-4" /> Edit
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem
                  onClick={() => deleteClient(c.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [canPoints, canUpdate, canDelete, openStatsModal, router]);

  const table = useReactTable({
    data: canView ? clients : [], // keep hooks stable even if access is denied/loading
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* ── guards AFTER hooks (keeps hook order stable) ──────────────── */
  if (viewLoading || !canView) return null;

  /* ── JSX ───────────────────────────────────────────────────────── */
  return (
    <>
      {/* Adjust points dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Points</DialogTitle>
          </DialogHeader>

          {selected && (
            <>
              <p className="mb-2">
                <strong>{selected.username}</strong> current balance:&nbsp;
                <span className="font-mono">{selected.points}</span>
              </p>

              {/* Sign selector — stacked on mobile, side-by-side on ≥sm */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
                <Button
                  type="button"
                  variant={sign === "add" ? "default" : "outline"}
                  className="w-full"
                  onClick={() => setSign("add")}
                  aria-pressed={sign === "add"}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add
                </Button>
                <Button
                  type="button"
                  variant={sign === "subtract" ? "destructive" : "outline"}
                  className="w-full"
                  onClick={() => setSign("subtract")}
                  aria-pressed={sign === "subtract"}
                >
                  <Minus className="h-4 w-4 mr-2" />
                  Subtract
                </Button>
              </div>

              {/* Amount (non-negative) */}
              <Input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={0}
                step={1}
                placeholder="Amount"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />

              {/* Effective change preview */}
              <p className="text-sm text-muted-foreground mt-2">
                Effective change:&nbsp;
                <span className={`font-mono ${sign === "subtract" ? "text-destructive" : "text-green-600"}`}>
                  {sign === "subtract" ? "-" : "+"}
                  {Math.floor(Math.max(0, Number.isFinite(Number(delta)) ? Math.abs(Number(delta)) : 0))}
                </span>{" "}
                pts
              </p>

              <DialogFooter className="mt-4">
                <Button
                  variant="secondary"
                  onClick={() => setDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={saveAdjustment} disabled={saving}>
                  {saving ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Toolbar (replaces Card header) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search clients…"
            className="pl-8"
            value={search}
            onChange={(e) =>
              startTransition(() => {
                setSearch(e.target.value);
                setPage(1);
              })
            }
          />
        </div>

        <Select
          value={pageSize.toString()}
          onValueChange={(v) =>
            startTransition(() => {
              setPageSize(Number(v));
              setPage(1);
            })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Rows" />
          </SelectTrigger>
          <SelectContent>
            {["5", "10", "20", "50"].map((n) => (
              <SelectItem key={n} value={n}>
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Standard data table (no Card wrapper) */}
      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={loading}
        skeletonRows={8}
        emptyMessage="No clients"
      />

      {/* Pagination */}
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
          >
            <ChevronLeft className="h-4 w-4" />
            <ChevronLeft className="h-4 w-4 -ml-2" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => p - 1)}
            disabled={page === 1 || loading}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage((p) => p + 1)}
            disabled={page === totalPages || loading}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setPage(totalPages)}
            disabled={page === totalPages || loading}
          >
            <ChevronRight className="h-4 w-4" />
            <ChevronRight className="h-4 w-4 -ml-2" />
          </Button>
        </div>
      </div>

      {/* statistics dialog */}
      <Dialog open={statsOpen} onOpenChange={setStatsOpen}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Client Statistics</DialogTitle>
          </DialogHeader>
          {statsLoading ? (
            <div className="flex items-center justify-center py-8">
              <p>Loading…</p>
            </div>
          ) : statsData ? (
            <div className="mt-6 grid gap-6 md:grid-cols-3">
              <div className="border rounded-lg p-6 text-center">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Total Orders
                </h3>
                <p className="text-3xl font-bold text-primary">
                  {statsData.totalOrders}
                </p>
              </div>
              <div className="border rounded-lg p-6 text-center">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Most Purchased Product
                </h3>
                <p className="text-lg font-medium">
                  {typeof statsData.mostPurchased === "string"
                    ? statsData.mostPurchased
                    : (statsData.mostPurchased as any)?.title ?? "N/A"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {statsData.quantityPurchased} units
                </p>
              </div>
              <div className="border rounded-lg p-6 text-center">
                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Last Purchase
                </h3>
                <p className="text-lg font-medium">
                  {statsData.lastPurchase ? formatDate(statsData.lastPurchase) : "N/A"}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center py-8">
              <p>No data available.</p>
            </div>
          )}
          <DialogFooter className="mt-6">
            <Button onClick={() => setStatsOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
