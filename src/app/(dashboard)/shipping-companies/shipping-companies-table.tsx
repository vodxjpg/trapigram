// src/app/(dashboard)/shipping-companies/shipping-companies-table.tsx
"use client";

import {
  useEffect,
  useState,
  startTransition,
  type FormEvent,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
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

import { useDebounce } from "@/hooks/use-debounce";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

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
type ShippingMethod = {
  id: string;
  name: string;
  countries: string[];
  createdAt: string;
  updatedAt: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function ShippingMethodsTable() {
  const router = useRouter();

  /* org & permissions */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: permLoading } = useHasPermission(
    organizationId,
    { shippingMethods: ["view"] }
  );
  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    shippingMethods: ["create"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    shippingMethods: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    shippingMethods: ["delete"],
  });

  /* state */
  const [methods, setMethods] = useState<ShippingMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  const [toDelete, setToDelete] = useState<ShippingMethod | null>(null);

  /* redirect if no view */
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/shipping-companies");
  }, [permLoading, canView, router]);

  /* fetch */
  const fetchMethods = async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: debounced,
      });
      const res = await fetch(`/api/shipping-companies?${qs.toString()}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setMethods(json.shippingMethods);
      setTotalPages(json.totalPages);
      setCurrentPage(json.currentPage);
    } catch {
      toast.error("Failed to load shipping companies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permLoading) return;
    fetchMethods();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, debounced, permLoading, canView]);

  /* handlers */
  const handleSearchSubmit = (e: FormEvent) => e.preventDefault();

  const handleDeleteConfirm = async () => {
    if (!toDelete) return;
    try {
      const res = await fetch(`/api/shipping-companies/${toDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Shipping method deleted");
      fetchMethods();
    } catch {
      toast.error("Failed to delete");
    } finally {
      setToDelete(null);
    }
  };

  const handleEdit = (m: ShippingMethod) =>
    router.push(`/shipping-companies/${m.id}`);
  const handleAdd = () => router.push("/shipping-companies/new");

  if (permLoading || !canView) return null;

  /* columns for StandardDataTable */
  const columns = useMemo<ColumnDef<ShippingMethod>[]>(() => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => row.original.name,
      },
      {
        id: "countries",
        header: "Countries",
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-1">
            {row.original.countries.map((c) => (
              <Badge key={c} variant="outline" className="mr-1">
                {c}
              </Badge>
            ))}
          </div>
        ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canUpdate && (
                  <DropdownMenuItem onClick={() => handleEdit(row.original)}>
                    <Edit className="mr-2 h-4 w-4" /> Edit
                  </DropdownMenuItem>
                )}
                {canDelete && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setToDelete(row.original)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" /> Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
      },
    ];
  }, [canUpdate, canDelete]);

  /* TanStack table instance */
  const table = useReactTable({
    data: methods,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 w-full sm:w-auto">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search companies…"
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
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" /> Add Company
          </Button>
        )}
      </div>

      {/* Standardized table */}
      <StandardDataTable<ShippingMethod>
        table={table}
        columns={columns}
        isLoading={loading}
        emptyMessage="No shipping companies found."
        skeletonRows={5}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              startTransition(() => {
                setPageSize(Number(v));
                setCurrentPage(1);
              });
            }}
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
      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Shipping Method?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete “{toDelete?.name}”?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirm}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
