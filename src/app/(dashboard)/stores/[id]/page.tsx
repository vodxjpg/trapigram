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
  DialogTrigger,
  DialogClose,
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
import {
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  ArrowLeft,
  Search,
  Info,
  Monitor,
  RefreshCw,
  Link2,
} from "lucide-react";
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

/* ───────────────────────── Types ───────────────────────── */
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

  // NEW: customer display fields (fetched via /api/pos/registers/:id)
  displaySessionId?: string | null;
  displayPairedAt?: string | null;
};

/* ───────────────────────── Helpers ───────────────────────── */
function buildPortalUrl(origin: string) {
  // Public page that requires no auth (you created /customer-display)
  return `${origin.replace(/\/$/, "")}/customer-display`;
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

/* ─────────────────── Inline Manage Display Panel ───────────────────
   This replaces the old CustomerDisplayStatus and removes all expiry UX.
   It shows:
     • Current status (Paired / Not paired)
     • Generate 6-digit code (non-expiring UX)
     • Unpair
     • Portal URL + quick QR
*/
function ManageCustomerDisplay({ registerId, onChanged }: { registerId: string; onChanged?: () => void }) {
  const [loading, setLoading] = React.useState(false);
  const [statusLoading, setStatusLoading] = React.useState(true);
  const [paired, setPaired] = React.useState<boolean>(false);
  const [pairedAt, setPairedAt] = React.useState<string | null>(null);
  const [code, setCode] = React.useState<string | null>(null);
  const [portalUrl, setPortalUrl] = React.useState<string | null>(null);

  const refreshStatus = React.useCallback(async () => {
    setStatusLoading(true);
    try {
      const r = await fetch(`/api/pos/registers/${registerId}`);
      if (!r.ok) throw new Error("Failed to load register");
      const j = await r.json();
      const reg = j.register || j;
      setPaired(Boolean(reg?.displaySessionId));
      setPairedAt(reg?.displayPairedAt ?? null);
    } catch (e: any) {
      toast.error(e?.message || "Could not load display status");
    } finally {
      setStatusLoading(false);
    }
  }, [registerId]);

  React.useEffect(() => {
    // initial status + compute default portal url
    refreshStatus();
    if (typeof window !== "undefined") {
      setPortalUrl(buildPortalUrl(window.location.origin));
    }
  }, [refreshStatus]);

  async function gen() {
    setLoading(true);
    try {
      const r = await fetch(`/api/pos/registers/${registerId}/customer-display/code`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();

      // The backend may return portalUrl; if not, fallback to our computed one.
      setCode(j.code);
      setPortalUrl(j.portalUrl || (typeof window !== "undefined" ? buildPortalUrl(window.location.origin) : null));

      toast.success("Pairing code generated");
      // NOTE: No expiry text — by policy, the code is reusable until unpaired/rotated.
    } catch (e: any) {
      toast.error(e?.message || "Failed to generate code");
    } finally {
      setLoading(false);
    }
  }

  async function unpair() {
    setLoading(true);
    try {
      const r = await fetch(`/api/pos/registers/${registerId}/customer-display/unpair`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      toast.success("Customer display unpaired");
      setPaired(false);
      setPairedAt(null);
      setCode(null);
      onChanged?.();
    } catch (e: any) {
      toast.error(e?.message || "Failed to unpair");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">Status</div>
        <div className="text-xs text-muted-foreground">
          {statusLoading ? "Loading…" : paired ? "Paired" : "Not paired"}
        </div>
      </div>

      {paired && (
        <div className="rounded-md border p-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Paired</div>
              {pairedAt && (
                <div className="text-xs text-muted-foreground">
                  Since {new Date(pairedAt).toLocaleString()}
                </div>
              )}
            </div>
            <Button variant="outline" onClick={unpair} disabled={loading}>
              Unpair
            </Button>
          </div>
          {portalUrl && (
            <div className="mt-3 text-xs">
              Open display at: <ExternalLink href={portalUrl}>{portalUrl}</ExternalLink>
            </div>
          )}
        </div>
      )}

      {!paired && (
        <div className="rounded-md border p-3 space-y-3">
          <div className="text-sm">
            Generate a 6-digit code to pair a screen. The pairing remains active until you unpair.
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={gen} disabled={loading}>Generate code</Button>
            <Button variant="outline" onClick={refreshStatus}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh status
            </Button>
          </div>

          {!!code && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-center">
              <div className="md:col-span-2">
                <Label>6-digit pairing code</Label>
                <Input readOnly value={code} className="text-2xl tracking-widest text-center font-mono" />
                {portalUrl && (
                  <p className="text-xs mt-1">
                    Open customer screen at:&nbsp;
                    <ExternalLink href={portalUrl}>{portalUrl}</ExternalLink>
                  </p>
                )}
              </div>
              {portalUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Portal QR"
                  className="mx-auto h-32 w-32"
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(portalUrl)}`}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── Main Page ───────────────────────── */
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

  // Manage display dialog
  const [displayOpen, setDisplayOpen] = React.useState(false);
  const [displayRegisterId, setDisplayRegisterId] = React.useState<string | null>(null);

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
      const base: Register[] = r.registers || [];

      // Fetch display status for each register so table shows Paired/Not paired after refresh
      const withStatus = await Promise.all(
        base.map(async (reg) => {
          try {
            const res = await fetch(`/api/pos/registers/${reg.id}`);
            if (!res.ok) return reg;
            const j = await res.json();
            const details = j.register || j;
            return {
              ...reg,
              displaySessionId: details?.displaySessionId ?? null,
              displayPairedAt: details?.displayPairedAt ?? null,
            } as Register;
          } catch {
            return reg;
          }
        })
      );

      setRows(withStatus);

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

  /* ─────────────────── Table Columns ─────────────────── */
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
    // NEW: Customer Display status
    {
      id: "display",
      header: "Customer display",
      size: 220,
      cell: ({ row }) => {
        const r = row.original;
        const paired = Boolean(r.displaySessionId);
        return (
          <div className="flex items-center gap-2">
            <Badge variant={paired ? "default" : "secondary"}>
              {paired ? "Paired" : "Not paired"}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2 gap-2"
              onClick={() => {
                setDisplayRegisterId(r.id);
                setDisplayOpen(true);
              }}
              title="Manage customer display"
            >
              <Monitor className="h-4 w-4" />
              Manage
            </Button>
          </div>
        );
      },
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

  /* ─────────────────── Create / Edit ─────────────────── */
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
            "Idempotency-Key":
              (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
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

  /* ─────────────────── Delete ─────────────────── */
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

  /* ─────────────────── Render ─────────────────── */
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
                      <strong>Registers</strong> are the POS endpoints inside this store
                      (e.g. “Front Counter”, “Pickup Desk”). You can add multiple registers per store.
                    </p>
                    <p>
                      Toggle a register’s <strong>Active</strong> state to hide/show it in the POS selector.
                      Use the actions menu to rename or delete a register.
                    </p>
                    <p className="flex items-center gap-1">
                      <Link2 className="h-3.5 w-3.5" />
                      Pair a dedicated screen from the new <strong>Customer display</strong> column.
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

      {/* Manage Customer Display */}
      <Dialog open={displayOpen} onOpenChange={setDisplayOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Customer display</DialogTitle>
          </DialogHeader>
          {displayRegisterId ? (
            <ManageCustomerDisplay
              registerId={displayRegisterId}
              onChanged={async () => {
                // After unpair or actions, refresh table so the paired badge updates
                await load();
              }}
            />
          ) : null}
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
