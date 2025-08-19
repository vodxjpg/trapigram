// src/app/(dashboard)/warehouses/warehouse-table.tsx
"use client";

import { useState, useEffect, startTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Plus,
  Search,
  MoreVertical,
  Edit,
  Trash2,
  Share2,
  RefreshCw,
} from "lucide-react";

import { useDebounce } from "@/hooks/use-debounce"; // ← NEW
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { WarehouseDrawer } from "./warehouse-drawer";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Warehouse = {
  id: string;
  tenantId: string | null;
  organizationId: string[];
  name: string;
  countries: string[];
  createdAt: Date;
  updatedAt: Date;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function WarehouseTable() {
  const router = useRouter();

  /* ── permissions ──────────────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    organizationId,
    { warehouses: ["view"] }
  );

  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    warehouses: ["create"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    warehouses: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    warehouses: ["delete"],
  });
  const { hasPermission: canShare } = useHasPermission(organizationId, {
    warehouses: ["sharing"],
  });
  const { hasPermission: canSync } = useHasPermission(organizationId, {
    warehouses: ["synchronize"],
  });

  /* ── data state ───────────────────────────────────────────────── */
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);

  /* ── UI state ─────────────────────────────────────────────────── */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingWarehouse, setEditingWarehouse] = useState<Warehouse | null>(
    null
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [syncToken, setSyncToken] = useState("");

  /* ── search text (debounced) ──────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300); // ← NEW

  /* ---------------------------------------------------------------- */
  /*  Guards                                                          */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/dashboard");
  }, [viewLoading, canView, router]);

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                           */
  /* ---------------------------------------------------------------- */
  const fetchWarehouses = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ search: debounced });
      const res = await fetch(`/api/warehouses?${qs.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch warehouses");
      const data = await res.json();
      setWarehouses(data.warehouses);
    } catch {
      toast.error("Failed to load warehouses");
    } finally {
      setLoading(false);
    }
  };

  /* initial & on-search fetch */
  useEffect(() => {
    if (!viewLoading && canView) fetchWarehouses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewLoading, canView, debounced]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                        */
  /* ---------------------------------------------------------------- */
  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this warehouse?")) return;
    try {
      const res = await fetch(`/api/warehouses/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.success("Warehouse deleted successfully");
      fetchWarehouses();
    } catch {
      toast.error("Failed to delete warehouse");
    }
  };

  const handleEdit = (w: Warehouse) => {
    setEditingWarehouse(w);
    setDrawerOpen(true);
  };
  const handleAdd = () => {
    setEditingWarehouse(null);
    setDrawerOpen(true);
  };
  const handleDrawerClose = (refresh = false) => {
    setDrawerOpen(false);
    setEditingWarehouse(null);
    if (refresh) fetchWarehouses();
  };

  const handleSyncWarehouse = () => {
    let token = syncToken.trim();
    try {
      const parsed = new URL(token);
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length) token = parts[parts.length - 1];
    } catch {
      /* raw token, ignore */
    }
    if (!token) {
      toast.error("Please enter a valid invitation code or link");
      return;
    }
    setDialogOpen(false);
    router.push(`/share/${token}`);
  };

  if (viewLoading || !canView) return null;

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap justify-between gap-4">
        {/* Search */}
        <form
          onSubmit={(e: FormEvent) => e.preventDefault()}
          className="relative max-w-sm flex-1"
        >
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search warehouses…"
            className="pl-8 w-full"
            value={searchQuery}
            onChange={(e) =>
              startTransition(() => {
                setSearchQuery(e.target.value);
              })
            }
          />
        </form>

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {canSync && (
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Sync Warehouse
            </Button>
          )}
          {canCreate && (
            <Button onClick={handleAdd}>
              <Plus className="mr-2 h-4 w-4" />
              Add Warehouse
            </Button>
          )}
          {canShare && (
            <Button asChild>
              <Link href="/warehouses/share-links">
                <Share2 className="mr-2 h-4 w-4" />
                View Share Links
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Organizations</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : warehouses.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No warehouses found.
                </TableCell>
              </TableRow>
            ) : (
              warehouses.map((w) => (
                <TableRow key={w.id}>
                  <TableCell>
                    <div className="inline-flex items-center gap-1">
                      <span>{w.id}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => {
                          navigator.clipboard.writeText(w.id);
                          toast.success("ID copied to clipboard");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium">{w.name}</TableCell>
                  <TableCell>
                    {w.organizationId.map((id) => (
                      <Badge key={id} variant="outline" className="mr-1">
                        {id}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>
                    {w.countries.map((c) => (
                      <Badge key={c} variant="outline" className="mr-1">
                        {c}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => handleEdit(w)}>
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canShare && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/warehouses/${w.id}/share`}
                                className="flex items-center"
                              >
                                <Share2 className="mr-2 h-4 w-4" />
                                Share
                              </Link>
                            </DropdownMenuItem>
                          </>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => handleDelete(w.id)}
                              className="text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
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

      {/* Drawer */}
      <WarehouseDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        warehouse={editingWarehouse}
      />

      {/* Sync dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sync Warehouse</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Enter invitation code or full URL"
            value={syncToken}
            onChange={(e) => setSyncToken(e.target.value)}
          />
          <DialogFooter>
            <Button onClick={handleSyncWarehouse}>Sync Warehouse</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
