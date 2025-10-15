// src/app/(dashboard)/shipments/shipment-table.tsx
"use client";

import {
  useEffect,
  useState,
  startTransition,
  type FormEvent,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";

import { useDebounce } from "@/hooks/use-debounce";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";

/* NEW: TanStack + standardized table */
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type CostGroup = {
  minOrderCost: number;
  maxOrderCost: number;
  shipmentCost: number;
};
type Shipment = {
  id: string;
  title: string;
  description: string;
  countries: string[];
  costs: CostGroup[];
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function ShipmentsTable() {
  const router = useRouter();

  /* ── active org & permissions ─────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: permLoading } = useHasPermission(
    organizationId,
    { shipping: ["view"] }
  );
  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    shipping: ["create"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    shipping: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    shipping: ["delete"],
  });

  /* ── state ─────────────────────────────────────────────────────── */
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  /* search with debounce */
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  /* sorting */
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const toggleSort = () =>
    setSortDirection((d) => (d === "asc" ? "desc" : "asc"));

  /* delete dialog */
  const [shipmentToDelete, setShipmentToDelete] = useState<Shipment | null>(
    null
  );

  /* ── redirect if no view ───────────────────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/dashboard");
  }, [permLoading, canView, router]);

  /* ── fetch data ────────────────────────────────────────────────── */
  const fetchShipments = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: debounced,
      });
      const res = await fetch(`/api/shipments?${qs.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setShipments(json.shipments);
      setTotalPages(json.totalPages);
      setCurrentPage(json.currentPage);
    } catch {
      toast.error("Failed to load shipments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!permLoading) fetchShipments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permLoading, canView, currentPage, pageSize, debounced]);

  /* ── handlers ──────────────────────────────────────────────────── */
  const handleSearchSubmit = (e: FormEvent) => e.preventDefault();

  const handleDeleteConfirmed = async () => {
    if (!shipmentToDelete) return;
    try {
      const res = await fetch(`/api/shipments/${shipmentToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Shipment deleted");
      setShipmentToDelete(null);
      fetchShipments();
    } catch {
      toast.error("Failed to delete");
    }
  };

  /* ── guards ────────────────────────────────────────────────────── */
  if (permLoading || !canView) return null;

  /* ── derived & sorting ------------------------------------------ */
  const sorted = useMemo(() => {
    const list = [...shipments];
    list.sort((a, b) =>
      sortDirection === "asc"
        ? a.title.localeCompare(b.title)
        : b.title.localeCompare(a.title)
    );
    return list;
  }, [shipments, sortDirection]);

  /* ── columns for StandardDataTable ─────────────────────────────── */
  const columns = useMemo<ColumnDef<Shipment>[]>(() => {
    return [
      {
        accessorKey: "title",
        header: () => (
          <button
            type="button"
            className="cursor-pointer select-none"
            onClick={toggleSort}
            aria-label="Sort by title"
          >
            Title {sortDirection === "asc" ? "↑" : "↓"}
          </button>
        ),
        cell: ({ row }) => row.original.title,
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => (
          <div className="truncate max-w-xs">{row.original.description}</div>
        ),
      },
      {
        id: "countries",
        header: "Countries",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.countries.map((c) => (
              <Badge key={c} variant="outline" className="mr-1 mb-1">
                {c}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "costs",
        header: "Costs",
        cell: ({ row }) => (
          <div className="space-y-1">
            {row.original.costs.map((g, i) => (
              <div key={i} className="text-sm">
                {g.minOrderCost.toFixed(2)}–{g.maxOrderCost.toFixed(2)} ={" "}
                {g.shipmentCost.toFixed(2)}
              </div>
            ))}
          </div>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const s = row.original;
          if (!canUpdate && !canDelete) return null;
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
                    <DropdownMenuItem
                      onClick={() => router.push(`/shipments/${s.id}`)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {canDelete && (
                    <DropdownMenuItem
                      className="text-destructive"
                      onClick={() => setShipmentToDelete(s)}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ];
  }, [canUpdate, canDelete, router, sortDirection]);

  /* ── TanStack table instance ───────────────────────────────────── */
  const table = useReactTable({
    data: sorted,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* ── JSX ───────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search shipments…"
              className="pl-8 w-full"
              value={query}
              onChange={(e) =>
                startTransition(() => {
                  setQuery(e.target.value);
                  setCurrentPage(1);
                })
              }
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        {canCreate && (
          <Button onClick={() => router.push("/shipments/new")}>
            <Plus className="mr-2 h-4 w-4" />
            Add shipping method
          </Button>
        )}
      </div>

      {/* Standardized table */}
      <StandardDataTable<Shipment>
        table={table}
        columns={columns}
        isLoading={loading}
        emptyMessage="No shipments found."
        skeletonRows={5}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex-row sm:flex-col">
            <p className="text-sm font-medium">Rows / page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) =>
                startTransition(() => {
                  setPageSize(Number(v));
                  setCurrentPage(1);
                })
              }
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize.toString()} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50].map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center space-x-2">
            <Button
              size="icon"
              variant="outline"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={currentPage === totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Delete dialog */}
      <AlertDialog
        open={!!shipmentToDelete}
        onOpenChange={(open) => !open && setShipmentToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipment?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete “{shipmentToDelete?.title}”?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
