// /home/zodx/Desktop/Trapyfy/src/app/(dashboard)/clients/clients-table.tsx
"use client";

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

countriesLib.registerLocale(en);

/* ───────────── Types ───────────── */
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

/* ───────────── Component ───────────── */
export function ClientsTable() {
  const router = useRouter();

  /* table state */
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");

  /* dialog state */
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Client | null>(null);
  const [delta, setDelta] = useState("");

  /* ── debounce search ── */
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 400);
    return () => clearTimeout(id);
  }, [search]);

  /* ── fetch clients ── */
  const fetchClients = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clients?page=${page}&pageSize=${pageSize}&search=${debounced}`,
        { headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" } },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Fetch failed");
      const { clients, totalPages, currentPage } = await res.json();
       // 1) load raw clients...
 setClients(clients);
     setTotalPages(totalPages);
     setPage(currentPage);
 // 2) then fetch all balances in one go
 const balRes = await fetch(
   `/api/affiliate/points/balance`,
   { headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" } }
 );
 if (!balRes.ok) throw new Error("Could not load balances");
 const { balances } = await balRes.json(); // [{ clientId, pointsCurrent, pointsSpent }, …]

 // 3) merge balances into clients
 setClients(cs =>
   cs.map(c => {
     const b = balances.find(x => x.clientId === c.id);
     return { ...c, points: b?.pointsCurrent ?? 0 };
   })
 );

    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => void fetchClients(), [page, pageSize, debounced]);

  /* ── delete ── */
  const deleteClient = async (id: string) => {
    if (!confirm("Delete this client?")) return;
    await fetch(`/api/clients/${id}`, {
      method: "DELETE",
      headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "" },
    }).then(fetchClients);
  };

  /* ── dialog helpers ── */
  const openDialog = (client: Client) => {
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
      const res = await fetch("/api/affiliate/points", {
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
      if (!res.ok) throw new Error((await res.json()).error || "Update failed");
      toast.success("Points updated");
      setOpen(false);
      /* redirect to Affiliates dashboard */
      router.push("/affiliates");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  /* ───────────── JSX ───────────── */
  return (
    <>
      {/* Adjust Points dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Points</DialogTitle>
          </DialogHeader>
          {selected && (
            <>
              <p>
                <strong>{selected.username}</strong> current balance:&nbsp;
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

      {/* main card */}
      <Card className="p-4">
        {/* search + size */}
        <div className="flex items-center justify-between mb-4">
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
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

        {/* table */}
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
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : clients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center">
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
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDialog(c)}>
                            <DollarSign className="mr-2 h-4 w-4" />
                            Adjust Points
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/clients/${c.id}`)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => deleteClient(c.id)}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
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
    </>
  );
}
