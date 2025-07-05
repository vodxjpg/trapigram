"use client";

import { useCallback } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  DollarSign,
  Edit,
  MoreVertical,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { authClient } from "@/lib/auth-client";
import { usePermission } from "@/hooks/use-permission";

countriesLib.registerLocale(en);

/* ------------------------------------------------------------------------- */
/*  Types                                                                    */
/* ------------------------------------------------------------------------- */
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

/* ------------------------------------------------------------------------- */
/*  Component                                                                */
/* ------------------------------------------------------------------------- */
export function ClientsTable() {
 const router = useRouter();
 // get active org for permission checks
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId               = activeOrg?.id ?? null;
    
  // permission flags
  const { hasPermission: canView,    isLoading: viewLoading }   = useHasPermission(orgId, { customer: ["view"] });
  const { hasPermission: canCreate,  isLoading: createLoading } = useHasPermission(orgId, { customer: ["create"] });
  const { hasPermission: canUpdate,  isLoading: updateLoading } = useHasPermission(orgId, { customer: ["update"] });
  const { hasPermission: canDelete,  isLoading: deleteLoading } = useHasPermission(orgId, { customer: ["delete"] });
  const { hasPermission: canPoints,  isLoading: pointsLoading } = useHasPermission(orgId, { affiliates: ["points"] });

  /* --------------------------- local state ------------------------------ */
  const [statsOpen,    setStatsOpen]    = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsData,    setStatsData]    = useState<{
    totalOrders: number;
    mostPurchased: string;
    quantityPurchased: number;
    lastPurchase: string;
  } | null>(null);

  const [clients,   setClients]   = useState<Client[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [totalPages,setTotalPages]= useState(1);
  const [page,      setPage]      = useState(1);
  const [pageSize,  setPageSize]  = useState(10);
  const [search,    setSearch]    = useState("");
  const [debounced, setDebounced] = useState("");
  const [open,      setOpen]      = useState(false);
  const [selected,  setSelected]  = useState<Client | null>(null);
  const [delta,     setDelta]     = useState("");

  /* --------------------------- permissions ------------------------------ */
  const canView   = can({ customer: ["view"] });
  const canCreate = can({ customer: ["create"] });
  const canUpdate = can({ customer: ["update"] });
  const canDelete = can({ customer: ["delete"] });
  const canPoints = can({ affiliates: ["points"] });

  /* --------------------------- helpers ---------------------------------- */
  const formatDate = (d: string | Date) => {
    const date = new Date(d);
    const pad  = (n: number) => String(n).padStart(2, "0");
    return `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
  };

  /* --------------------------- debounce search -------------------------- */
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(id);
  }, [search]);

  /* --------------------------- data fetch ------------------------------- */
  const fetchClients = async () => {
    if (!canView) return;             // guard – no rights ⇒ no work
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients?page=${page}&pageSize=${pageSize}&search=${debounced}`,
        {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
          },
        },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Fetch failed");

      const { clients, totalPages, currentPage } = await res.json();
      setClients(clients);
      setTotalPages(totalPages);
      setPage(currentPage);

      /* merge affiliate balances --------------------------------------- */
      const balRes = await fetch("/api/affiliate/points/balance", {
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
      });
      if (!balRes.ok) throw new Error("Could not load balances");
      const { balances } = await balRes.json();

      setClients((cs) =>
        cs.map((c) => ({
          ...c,
          points: balances.find((b) => b.clientId === c.id)?.pointsCurrent ?? 0,
        })),
      );
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(
    () => {
      fetchClients();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [page, pageSize, debounced, canView],
  );

  /* --------------------------- callbacks -------------------------------- */
  const openStatsModal = useCallback(async (id: string) => {
    setStatsOpen(true);
    setStatsLoading(true);
    try {
      const res = await fetch(`/api/clients/${id}`);
      const data = await res.json();
      setStatsData({
        totalOrders:        data.totalOrders,
        mostPurchased:      data.mostPurchased,
        quantityPurchased:  data.quantityPurchased,
        lastPurchase:       data.lastPurchase,
      });
    } catch (err: any) {
      toast.error(err.message);
      setStatsData(null);
    } finally {
      setStatsLoading(false);
    }
  }, []);

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

  const openDialog = (client: Client) => {
    if (!canPoints) return;
    setSelected(client);
    setDelta("");
    setOpen(true);
  };

  const saveAdjustment = async () => {
    const val = Number(delta);
    if (!selected || !Number.isFinite(val) || val === 0) {
      toast.error("Enter a non-zero integer");
      return;
    }
    try {
      await fetch("/api/affiliate/points", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
        body: JSON.stringify({
          id: selected.id,
          points: val,
          action: val > 0 ? "MANUAL_ADD" : "MANUAL_SUBTRACT",
          description: "Dashboard manual adjustment",
        }),
      });
      toast.success("Points updated");
      setOpen(false);
      router.push("/affiliates");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  /* --------------------------- GUARD → render --------------------------- */
  if (can.loading || !canView) return null;

  /* --------------------------- UI -------------------------------------- */
  return (
    <>
      {/* ─────────────────────── Adjust Points dialog ─────────────────── */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Points</DialogTitle>
          </DialogHeader>
          {selected && (
            <>
              <p>
                <strong>{selected.username}</strong>&nbsp;current balance:&nbsp;
                <span className="font-mono">{selected.points}</span>
              </p>
              <Input
                type="number"
                placeholder="Positive or negative integer"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
              <DialogFooter>
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveAdjustment}>Save</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ───────────────────────── Clients table ───────────────────────── */}
      <Card className="p-4">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients…"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(Number(v));
              setPage(1);
            }}
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

        {/* Table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Country</TableHead>
                <TableHead>Points</TableHead>
                <TableHead>Ref.</TableHead>
                <TableHead>Statistics</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center">
                    No clients
                  </TableCell>
                </TableRow>
              ) : (
                clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell>{c.username}</TableCell>
                    <TableCell>{`${c.firstName} ${c.lastName}`}</TableCell>
                    <TableCell>{c.email}</TableCell>
                    <TableCell>{c.phoneNumber}</TableCell>
                    <TableCell>
                      {c.country ? (
                        <div className="flex items-center">
                          <ReactCountryFlag
                            countryCode={c.country}
                            svg
                            style={{ width: "1em", height: "1em", marginRight: 6 }}
                          />
                          {countriesLib.getName(c.country, "en") ?? c.country}
                        </div>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{c.points}</TableCell>
                    <TableCell>{c.referredBy ?? "-"}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openStatsModal(c.id)}
                      >
                        <Search className="h-4 w-4" />
                      </Button>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canPoints && (
                            <DropdownMenuItem onClick={() => openDialog(c)}>
                              <DollarSign className="mr-2 h-4 w-4" />
                              Adjust Points
                            </DropdownMenuItem>
                          )}
                          {canUpdate && (
                            <DropdownMenuItem
                              onClick={() => router.push(`/clients/${c.id}`)}
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && (
                            <DropdownMenuItem
                              onClick={() => deleteClient(c.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

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
      </Card>

      {/* ─────────────────────── Statistics dialog ─────────────────────── */}
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
            <div className="mt-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
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
                    {statsData.mostPurchased?.title || "N/A"}
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
                    {statsData.lastPurchase
                      ? formatDate(statsData.lastPurchase.createdAt)
                      : "N/A"}
                  </p>
                </div>
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