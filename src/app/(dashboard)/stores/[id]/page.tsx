"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Trash2, ArrowLeft, Search } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Store = {
  id: string;
  name: string;
  address: Record<string, any> | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Register = {
  id: string;
  storeId: string;
  label: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export default function StoreRegistersPage() {
  const params = useParams() as { id: string };
  const router = useRouter();
  const storeId = params.id;

  const [store, setStore] = React.useState<Store | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [rows, setRows] = React.useState<Register[]>([]);
  const [query, setQuery] = React.useState("");

  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Register | null>(null);
  const [formLabel, setFormLabel] = React.useState("");
  const [formActive, setFormActive] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteIds, setDeleteIds] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [sRes, rRes] = await Promise.all([
        fetch(`/api/pos/stores/${storeId}`),
        fetch(`/api/pos/registers?storeId=${encodeURIComponent(storeId)}`),
      ]);
      if (!sRes.ok) throw new Error("Failed to load store");
      const s = await sRes.json();
      setStore(s.store);

      if (!rRes.ok) throw new Error("Failed to load registers");
      const r = await rRes.json();
      setRows(r.registers || []);
    } catch (e: any) {
      toast.error(e?.message || "Could not load data");
      router.replace("/stores");
    } finally {
      setIsLoading(false);
    }
  }, [storeId, router]);

  React.useEffect(() => {
    load();
  }, [load]);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return rows;
    const q = query.toLowerCase();
    return rows.filter((r) => r.label.toLowerCase().includes(q));
  }, [rows, query]);

  const table = useReactTable({
    data: filtered,
    columns: React.useMemo<ColumnDef<Register>[]>(() => [
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
        accessorKey: "label",
        header: "Register",
        cell: ({ row }) => <span className="font-medium">{row.original.label}</span>,
      },
      {
        accessorKey: "active",
        header: "Status",
        cell: ({ row }) =>
          row.original.active ? (
            <Badge variant="default">Active</Badge>
          ) : (
            <Badge variant="secondary" className="bg-muted text-foreground">
              Inactive
            </Badge>
          ),
        size: 90,
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
        cell: ({ row }) => {
          const r = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(r)} className="gap-2">
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className={cn("gap-2 text-destructive focus:text-destructive")}
                  onClick={() => {
                    setDeleteIds([r.id]);
                    setConfirmOpen(true);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        size: 40,
      },
    ], []),
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  function openCreate() {
    setEditing(null);
    setFormLabel("");
    setFormActive(true);
    setEditOpen(true);
  }

  function openEdit(r: Register) {
    setEditing(r);
    setFormLabel(r.label);
    setFormActive(Boolean(r.active));
    setEditOpen(true);
  }

  async function saveRegister() {
    setSaving(true);
    const payload = {
      label: formLabel.trim(),
      active: formActive,
      storeId, // (ignored by PATCH unless moving)
    };
    try {
      if (!payload.label) throw new Error("Label is required.");
      if (editing) {
        const res = await fetch(`/api/pos/registers/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ label: payload.label, active: payload.active }),
        });
        if (!res.ok) throw new Error("Failed to update register");
        toast.success("Register updated");
      } else {
        const res = await fetch(`/api/pos/registers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Failed to create register");
        toast.success("Register created");
      }
      setEditOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function hardOrSoftDelete(id: string) {
    const tryDelete = await fetch(`/api/pos/registers/${id}`, { method: "DELETE" });
    if (tryDelete.ok) return true;
    if (tryDelete.status === 405 || tryDelete.status === 404) {
      const soft = await fetch(`/api/pos/registers/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      return soft.ok;
    }
    return tryDelete.ok;
  }

  async function confirmBulkDelete() {
    const ids =
      deleteIds.length > 0
        ? deleteIds
        : table.getSelectedRowModel().rows.map((r) => r.original.id);

    if (!ids.length) {
      setConfirmOpen(false);
      return;
    }
    try {
      await Promise.all(ids.map((id) => hardOrSoftDelete(id)));
      toast.success(ids.length > 1 ? "Registers deleted" : "Register deleted");
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
        <div className="flex items-center gap-2">
          <Link href="/stores">
            <Button variant="ghost" className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {store ? store.name : "Store"}
            </h1>
            <p className="text-muted-foreground">Registers</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => {
                setDeleteIds(table.getSelectedRowModel().rows.map((r) => r.original.id));
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({selectedCount})
            </Button>
          )}
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Register
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search registers…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <StandardDataTable
        table={table}
        columns={table.getAllColumns().map((c) => c.columnDef as any)}
        isLoading={isLoading}
        emptyMessage="No registers for this store."
      />

      {/* Add/Edit Register */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit register" : "Add register"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Label *</Label>
              <Input
                value={formLabel}
                onChange={(e) => setFormLabel(e.target.value)}
                placeholder="Front Counter"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="mb-0">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive registers are hidden in POS outlet selector.
                  </p>
                </div>
                <Switch checked={formActive} onCheckedChange={setFormActive} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveRegister} disabled={saving}>
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
              Delete {deleteIds.length > 1 ? `${deleteIds.length} registers` : "register"}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            This will remove the register{deleteIds.length > 1 ? "s" : ""} from normal use. If hard delete
            isn’t available, we’ll deactivate instead.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={confirmBulkDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
