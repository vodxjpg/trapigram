// src/app/(dashboard)/payment-methods/payment-table.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

import { PaymentMethodDrawer } from "./payment-drawer";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

/* NEW: TanStack + standardized table */
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  apiKey?: string | null;
  secretKey?: string | null;
  description?: string | null;
  instructions?: string | null;
  default?: boolean;
}

export function PaymentMethodsTable() {
  const router = useRouter();

  // org + permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: permLoading } = useHasPermission(
    organizationId,
    { payment: ["view"] }
  );
  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    payment: ["create"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    payment: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    payment: ["delete"],
  });

  // state
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);

  // fetch
  const fetchMethods = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: searchQuery,
      });
      const res = await fetch(`/api/payment-methods?${qs}`);
      if (!res.ok) throw new Error("Failed to fetch payment methods");
      const data = await res.json();
      setMethods(data.methods);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error loading payment methods");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (canView) fetchMethods();
  }, [currentPage, pageSize, searchQuery, canView]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) return null;

  // actions
  const toggleActive = async (pm: PaymentMethod) => {
    if (!canUpdate) return;
    try {
      await fetch(`/api/payment-methods/${pm.id}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !pm.active }),
      });
      setMethods((prev) =>
        prev.map((m) => (m.id === pm.id ? { ...m, active: !pm.active } : m))
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  const deleteRow = async (pm: PaymentMethod) => {
    if (!canDelete) return;
    if (pm.default) {
      toast.error(
        "Default payment methods cannot be deleted. You can edit or deactivate them."
      );
      return;
    }
    if (!confirm("Delete this payment method?")) return;
    try {
      const res = await fetch(`/api/payment-methods/${pm.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || "Failed to delete");
      }
      toast.success("Deleted");
      fetchMethods();
    } catch (e: any) {
      toast.error(e?.message || "Failed to delete");
    }
  };

  const openDrawer = (row: PaymentMethod | null = null) => {
    if (!(canCreate || canUpdate)) return;
    setEditing(row);
    setDrawerOpen(true);
  };
  const onDrawerClose = (refresh = false) => {
    setDrawerOpen(false);
    setEditing(null);
    if (refresh) fetchMethods();
  };

  const truncate = (s?: string | null, n = 80) =>
    !s ? "" : s.length > n ? s.slice(0, n - 1) + "…" : s;

  /* -------------------- Columns for StandardDataTable -------------------- */
  const columns = useMemo<ColumnDef<PaymentMethod>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => {
          const pm = row.original;
          return (
            <div className="flex items-center gap-2">
              {pm.name}
              {pm.default && (
                <Badge variant="secondary" className="ml-1">
                  Default
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <span className="text-muted-foreground block max-w-[420px]">
            {truncate(row.original.description)}
          </span>
        ),
      },
      {
        id: "active",
        header: "Active",
        cell: ({ row }) => (
          <Switch
            checked={row.original.active}
            onCheckedChange={() => toggleActive(row.original)}
            disabled={!canUpdate}
          />
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const pm = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canUpdate && (
                    <DropdownMenuItem onClick={() => openDrawer(pm)}>
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => deleteRow(pm)}
                        className={
                          pm.default
                            ? "opacity-50"
                            : "text-destructive focus:text-destructive"
                        }
                        disabled={pm.default}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [canUpdate, canDelete]);

  /* -------------------- TanStack table instance -------------------- */
  const table = useReactTable({
    data: methods,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <>
      <div className="space-y-6">
        {/* Header / Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setCurrentPage(1);
              fetchMethods();
            }}
            className="flex w-full sm:w-auto gap-2"
          >
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search…"
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Button type="submit">Search</Button>
          </form>

          {canCreate && (
            <Button onClick={() => openDrawer(null)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Payment
            </Button>
          )}
        </div>

        {/* Standardized table */}
        <StandardDataTable<PaymentMethod>
          table={table}
          columns={columns}
          isLoading={loading}
          emptyMessage="No payment methods."
          skeletonRows={5}
        />

        {/* Pagination */}
        <div className="flex items-center justify-between mt-4">
          <div className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </div>
          <div className="flex items-center space-x-2">
            <div className="flex-row sm:flex-col">
              <p className="text-sm font-medium">Rows per page</p>
              <Select
                value={String(pageSize)}
                onValueChange={(v) => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent side="top">
                  {[5, 10, 20, 50, 100].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage(1)}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={currentPage === totalPages}
              onClick={() => setCurrentPage(totalPages)}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <PaymentMethodDrawer
          open={drawerOpen}
          onClose={onDrawerClose}
          method={editing}
        />
      </div>
    </>
  );
}
