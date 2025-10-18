// src/app/(dashboard)/stores/[id]/page.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
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
  DialogClose, // ← so "Got it" can close the dialog
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
import { MoreHorizontal, Pencil, Plus, Trash2, ArrowLeft, Search, Info } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipProvider,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import Select from "react-select";

type Store = {
  id: string;
  name: string;
  address: Record<string, any> | null;
  defaultReceiptTemplateId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type ReceiptTemplate = {
  id: string;
  name: string;
};

type Register = {
  id: string;
  storeId: string;
  name: string;
  walkInClientId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

type Client = {
  id: string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
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
  const [formName, setFormName] = React.useState("");
  const [formActive, setFormActive] = React.useState(true);
  const [formWalkInClientId, setFormWalkInClientId] = React.useState<string>("");
  const [saving, setSaving] = React.useState(false);

  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteIds, setDeleteIds] = React.useState<string[]>([]);

  // templates
  const [templates, setTemplates] = React.useState<ReceiptTemplate[]>([]);
  const templateById = React.useMemo(
    () => Object.fromEntries(templates.map((t) => [t.id, t])),
    [templates],
  );
  const [savingTemplate, setSavingTemplate] = React.useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [sRes, rRes, tRes] = await Promise.all([
        fetch(`/api/pos/stores/${storeId}`),
        fetch(`/api/pos/registers?storeId=${encodeURIComponent(storeId)}`),
        fetch(`/api/pos/receipt-templates`),
      ]);
      if (!sRes.ok) throw new Error("Failed to load store");
      const s = await sRes.json();
      setStore(s.store);

      if (!rRes.ok) throw new Error("Failed to load registers");
      const r = await rRes.json();
      setRows(r.registers || []);

      if (tRes.ok) {
        const tj = await tRes.json();
        setTemplates(tj.templates || []);
      }
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
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  // NOTE: use ColumnDef<Register, any>[] for smooth compatibility with StandardDataTable
  const columns = React.useMemo<ColumnDef<Register, any>[]>(() => [
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
      header: "Register",
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: "active",
      header: "Status",
      size: 100,
      cell: ({ row }) =>
        row.original.active ? (
          <Badge variant="default">Active</Badge>
        ) : (
          <Badge variant="secondary" className="bg-muted text-foreground">
            Inactive
          </Badge>
        ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      size: 110,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 40,
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
                className="gap-2 text-destructive focus:text-destructive"
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
    },
  ], []);

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormActive(true);
    setEditOpen(true);
  }

  function openEdit(r: Register) {
    setEditing(r);
    setFormName(r.name);
    setFormActive(Boolean(r.active));
    setEditOpen(true);
  }

  async function saveRegister() {
    setSaving(true);
    try {
      if (!formName.trim()) throw new Error("Name is required.");

      if (editing) {
        const res = await fetch(`/api/pos/registers/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: formName.trim(),
            active: formActive,
          }),
        });
        if (!res.ok) throw new Error("Failed to update register");
        toast.success("Register updated");
      } else {
        const res = await fetch(`/api/pos/registers`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify({
            storeId,
            name: formName.trim(),
            active: formActive,
          }),
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

  async function deleteNow(ids: string[]) {
    await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`/api/pos/registers/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("Delete failed");
      }),
    );
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
      await deleteNow(ids);
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

            {/* Subtitle + info tooltip/dialog */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <p>Registers</p>

              <Dialog>
                <TooltipProvider>
                  <Tooltip>
                    <DialogTrigger asChild>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-5 w-5 p-0"
                          aria-label="What are registers?"
                        >
                          <Info className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                    </DialogTrigger>
                    <TooltipContent>What are registers?</TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>About registers</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 text-sm">
                    <p>
                      <strong>Registers</strong> are the POS endpoints inside this store (e.g.
                      “Front Counter”, “Pickup Desk”). You can add multiple registers per store.
                    </p>
                    <p>
                      Toggle a register’s <strong>Active</strong> state to hide/show it in the POS selector.
                      Use the actions menu to rename or delete a register.
                    </p>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button type="button">Got it</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
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

      {/* Store receipt template selector */}
      <div className="rounded-lg border p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-medium">Default receipt template</div>
            <p className="text-sm text-muted-foreground">
              This template will be used by POS and receipt emails/PDF for this store.
            </p>
          </div>
          <div className="min-w-[300px]">
            <Select
              isClearable
              options={templates.map((t) => ({ value: t.id, label: t.name }))}
              value={
                store?.defaultReceiptTemplateId
                  ? {
                      value: store.defaultReceiptTemplateId,
                      label:
                        templateById[store.defaultReceiptTemplateId!]?.name ??
                        "Selected template",
                    }
                  : null
              }
              placeholder="Use organization default / none"
              onChange={async (opt: any) => {
                try {
                  setSavingTemplate(true);
                  const res = await fetch(`/api/pos/stores/${storeId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      defaultReceiptTemplateId: opt?.value ?? null,
                    }),
                  });
                  if (!res.ok) throw new Error("Failed to update template");
                  const j = await res.json();
                  setStore(j.store);
                  toast.success("Store template updated");
                } catch (e: any) {
                  toast.error(e?.message || "Update failed");
                } finally {
                  setSavingTemplate(false);
                }
              }}
              isDisabled={savingTemplate || isLoading}
            />
          </div>
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
        columns={columns}
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
              <Label>Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Front Counter"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <Label className="mb-0">Active</Label>
                  <p className="text-xs text-muted-foreground">
                    Inactive registers are hidden in the POS outlet selector.
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
            This permanently removes the register{deleteIds.length > 1 ? "s" : ""}.
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
