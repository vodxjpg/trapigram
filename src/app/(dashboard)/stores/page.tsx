"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Trash2, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* --- Country selector deps (same pattern as Coupons) -------------------- */
import Select from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
countriesLib.registerLocale(enLocale);
/* ----------------------------------------------------------------------- */

type Store = {
  id: string;
  name: string;
  address: Record<string, any> | null;
  createdAt: string;
  updatedAt: string;
};

function formatAddress(a?: Record<string, any> | null) {
  if (!a) return "—";
  const parts = [a.street || a.line1, a.city, a.state, a.zip || a.postalCode, a.country]
    .filter(Boolean);
  return parts.join(", ") || "—";
}

export default function StoresPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Store[]>([]);
  const [query, setQuery] = React.useState("");

  // add/edit dialog state
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Store | null>(null);
  const [formName, setFormName] = React.useState("");
  const [formAddress, setFormAddress] = React.useState({
    street: "",
    city: "",
    state: "",
    zip: "",
    country: "",
  });
  const [saving, setSaving] = React.useState(false);

  // delete confirm
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteIds, setDeleteIds] = React.useState<string[]>([]);

  // org countries for selector
  const [countryOptions, setCountryOptions] = React.useState<
    { value: string; label: string }[]
  >([]);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/pos/stores");
      if (!res.ok) throw new Error("Failed to load stores");
      const j = await res.json();
      setRows(j.stores || []);
    } catch (e: any) {
      toast.error(e?.message || "Could not load stores");
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  // fetch org sell-to countries (same endpoint used by Coupons)
  React.useEffect(() => {
    fetch("/api/organizations/countries", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
      },
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch organization countries");
        return res.json();
      })
      .then((data) => {
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        setCountryOptions(
          list.map((code) => ({
            value: code,
            label: countriesLib.getName(code, "en") || code,
          }))
        );
      })
      .catch((err) => toast.error(err.message || "Failed to load countries"));
  }, []);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        formatAddress(s.address).toLowerCase().includes(q)
    );
  }, [rows, query]);

  const columns = React.useMemo<ColumnDef<Store>[]>(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={table.getIsAllRowsSelected()}
            onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(v) => row.toggleSelected(!!v)}
            aria-label="Select row"
          />
        ),
        size: 30,
      },
      {
        accessorKey: "name",
        header: "Store",
        cell: ({ row }) => {
          const s = row.original;
          return (
            <Link
              href={`/stores/${s.id}`}
              className="font-medium text-primary hover:underline"
            >
              {s.name}
            </Link>
          );
        },
      },
      {
        id: "address",
        header: "Address",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {formatAddress(row.original.address)}
          </span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) => (
          <span className="text-muted-foreground">
            {new Date(row.original.createdAt).toLocaleDateString()}
          </span>
        ),
        size: 110,
      },
      {
        id: "actions",
        header: "",
        size: 40,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem className="gap-2" onClick={() => openEdit(s)}>
                  <Pencil className="h-4 w-4" /> Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="gap-2 text-destructive focus:text-destructive"
                  onClick={() => {
                    setDeleteIds([s.id]);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    []
  );

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormAddress({ street: "", city: "", state: "", zip: "", country: "" });
    setEditOpen(true);
  }

  function openEdit(s: Store) {
    setEditing(s);
    const a = s.address || {};
    setFormName(s.name);
    setFormAddress({
      street: a.street || a.line1 || "",
      city: a.city || "",
      state: a.state || "",
      zip: a.zip || a.postalCode || "",
      country: a.country || "",
    });
    setEditOpen(true);
  }

  async function saveStore() {
    setSaving(true);
    try {
      const payload = {
        name: formName.trim(),
        address: {
          street: formAddress.street || undefined,
          city: formAddress.city || undefined,
          state: formAddress.state || undefined,
          zip: formAddress.zip || undefined,
          country: formAddress.country || undefined, // ISO-2 from selector
        },
      };
      if (!payload.name) throw new Error("Name is required.");

      if (editing) {
        const res = await fetch(`/api/pos/stores/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to update store");
        toast.success("Store updated");
      } else {
        const res = await fetch(`/api/pos/stores`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key":
              (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create store");
        toast.success("Store created");
      }
      setEditOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteIdsNow(ids: string[]) {
    await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`/api/pos/stores/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("Delete failed");
      })
    );
  }

  async function confirmBulkDelete() {
    const ids = deleteIds.length
      ? deleteIds
      : table.getSelectedRowModel().rows.map((r) => r.original.id);

    if (!ids.length) {
      setConfirmOpen(false);
      return;
    }

    try {
      await deleteIdsNow(ids);
      toast.success(ids.length > 1 ? "Stores deleted" : "Store deleted");
      setConfirmOpen(false);
      setDeleteIds([]);
      await load();
    } catch {
      toast.error("Failed to delete");
    }
  }

  const selectedCount = table.getSelectedRowModel().rows.length;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Stores</h1>
          <p className="text-muted-foreground">Manage physical locations</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => {
                setDeleteIds(
                  table.getSelectedRowModel().rows.map((r) => r.original.id)
                );
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({selectedCount})
            </Button>
          )}
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Store
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No stores yet."
      />

      {/* Add/Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit store" : "Add store"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2 sm:col-span-2">
                <Label>Name *</Label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Downtown Shop"
                />
              </div>

              <div className="space-y-2">
                <Label>Street</Label>
                <Input
                  value={formAddress.street}
                  onChange={(e) =>
                    setFormAddress({ ...formAddress, street: e.target.value })
                  }
                  placeholder="123 Main St"
                />
              </div>

              <div className="space-y-2">
                <Label>City</Label>
                <Input
                  value={formAddress.city}
                  onChange={(e) =>
                    setFormAddress({ ...formAddress, city: e.target.value })
                  }
                  placeholder="Springfield"
                />
              </div>

              <div className="space-y-2">
                <Label>State</Label>
                <Input
                  value={formAddress.state}
                  onChange={(e) =>
                    setFormAddress({ ...formAddress, state: e.target.value })
                  }
                  placeholder="CA"
                />
              </div>

              <div className="space-y-2">
                <Label>ZIP</Label>
                <Input
                  value={formAddress.zip}
                  onChange={(e) =>
                    setFormAddress({ ...formAddress, zip: e.target.value })
                  }
                  placeholder="90210"
                />
              </div>

              {/* Country: restricted to org sell-to countries */}
              <div className="space-y-2">
                <Label>Country</Label>
                <Select
                  options={countryOptions}
                  placeholder="Select country"
                  isClearable
                  value={
                    formAddress.country
                      ? countryOptions.find(
                          (o) => o.value === formAddress.country
                        ) || null
                      : null
                  }
                  onChange={(opt) =>
                    setFormAddress({
                      ...formAddress,
                      country: opt ? (opt as any).value : "",
                    })
                  }
                  formatOptionLabel={(o: any) => (
                    <div className="flex items-center gap-2">
                      <ReactCountryFlag countryCode={o.value} svg style={{ width: 18 }} />
                      <span>{o.label}</span>
                    </div>
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Only countries your organization sells to.
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveStore} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteIds.length > 1 ? `${deleteIds.length} stores` : "store"}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the store{deleteIds.length > 1 ? "s" : ""} (and its registers).
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
