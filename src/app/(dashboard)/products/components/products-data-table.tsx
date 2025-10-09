// src/app/(dashboard)/products/components/products-data-table.tsx
"use client";

import {
  useEffect,
  useState,
  useMemo,
  useCallback,
  startTransition,
  useRef,
} from "react";
import { useDebounce } from "@/hooks/use-debounce";
type OrderField = "createdAt" | "updatedAt" | "title" | "sku";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { Copy, Edit, MoreHorizontal, Trash, ArrowUpDown } from "lucide-react";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { useProducts } from "@/hooks/use-products";
import { Checkbox } from "@/components/ui/checkbox";
import type { Attribute } from "@/types/product";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ------------------------------------------------------------ */
/*  Product type definition for the table                       */
/* ------------------------------------------------------------ */
export type Product = {
  id: string;
  title: string;
  image: string | null;
  sku: string;
  status: "published" | "draft";
  regularPrice: Record<string, number>;
  salePrice: Record<string, number> | null;
  maxRegularPrice: number; // ← NEW
  maxSalePrice: number | null; // ← NEW
  stockStatus: "managed" | "unmanaged";
  stockData: Record<string, Record<string, number>> | null;
  categories: string[];
  attributes: Attribute[];
  createdAt: string;
  productType: "simple" | "variable";
  variations: Array<{
    id: string;
    attributes: Record<string, string>;
    sku: string;
    image: string | null;
    prices: Record<string, { regular: number; sale: number | null }>;
    cost: Record<string, number>;
    stock: Record<string, Record<string, number>>;
  }>;
};

export interface ProductsDataTableProps {
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
  onProductsLoaded?: (rows: Product[]) => void;
  /** NEW (optional): notify parent of current query/sort to enable export-all */
  onQueryStateChange?: (q: {
    search: string;
    status?: "published" | "draft";
    categoryId?: string;
    attributeTermId?: string;
    orderBy: OrderField;
    orderDir: "asc" | "desc";
  }) => void;
}

export function ProductsDataTable({
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onProductsLoaded,
  onQueryStateChange, // NEW
}: ProductsDataTableProps) {
  /* ---------------------------------------------------------- */
  /*  1) Basic state & permissions                              */
  /* ---------------------------------------------------------- */
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { product: ["view"] }
  );
  const { hasPermission: canUpdate } = useHasPermission(orgId, {
    product: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(orgId, {
    product: ["delete"],
  });

  const [sorting, setSorting] = useState<SortingState>([]);
  /* NEW – server-side sort (field dir) ------------------------- */
  const [serverSort, setServerSort] = useState<{
    field: OrderField;
    dir: "asc" | "desc";
  }>({
    field: "createdAt",
    dir: "desc",
  });

  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // search & individual server-side filters
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);
  const [statusFilter, setStatusFilter] = useState<"published" | "draft" | "">(
    ""
  );
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [attributeFilter, setAttributeFilter] = useState<string>("");
  const [attributeTermFilter, setAttributeTermFilter] = useState<string>("");
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [termOptions, setTermOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [attributeOptions, setAttributeOptions] = useState<
    { id: string; name: string }[]
  >([]);

  const {
    products: productsRaw,
    isLoading,
    totalPages,
    mutate,
  } = useProducts({
    page,
    pageSize,
    search: debounced,
    status: statusFilter || undefined,
    categoryId: categoryFilter || undefined,
    attributeTermId: attributeTermFilter || undefined,
    orderBy: serverSort.field,
    orderDir: serverSort.dir,
  });
  const products = productsRaw ?? [];

  /* ---------------------------------------------------------- */
  /*  Push loaded rows up (avoid infinite loop)                 */
  /* ---------------------------------------------------------- */
  const lastSentIds = useRef<string>("");
  useEffect(() => {
    if (!onProductsLoaded) return;
    const ids = products.map((p) => p.id).join(",");
    if (ids !== lastSentIds.current) {
      onProductsLoaded(products);
      lastSentIds.current = ids;
    }
  }, [products, onProductsLoaded]);

  // 👇 NEW: lift current query/sort to parent for export usage
  const lastQueryJSON = useRef<string>("");
  useEffect(() => {
    if (!onQueryStateChange) return;
    const payload = {
      search: debounced,
      status: (statusFilter || undefined) as "published" | "draft" | undefined,
      categoryId: categoryFilter || undefined,
      attributeTermId: attributeTermFilter || undefined,
      orderBy: serverSort.field,
      orderDir: serverSort.dir,
    };
    const json = JSON.stringify(payload);
    if (json !== lastQueryJSON.current) {
      onQueryStateChange(payload);
      lastQueryJSON.current = json;
    }
  }, [
    onQueryStateChange,
    debounced,
    statusFilter,
    categoryFilter,
    attributeTermFilter,
    serverSort.field,
    serverSort.dir,
  ]);

  /* keep `page` within valid range */
  useEffect(() => {
    if (!totalPages) return;
    if (page > totalPages) onPageChange(Math.max(totalPages, 1));
  }, [page, totalPages, onPageChange]);

  /* ---------------------------------------------------------- */
  /*  2) Ancillary data fetches                                 */
  /* ---------------------------------------------------------- */
  useEffect(() => {
    fetch("/api/product-categories?page=1&pageSize=1000", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((r) => r.json())
      .then(({ categories }) => {
        const map: Record<string, string> = {};
        categories.forEach((c: { id: string; name: string }) => {
          map[c.id] = c.name;
        });
        setCategoryMap(map);
        setCategoryOptions(categories);
      })
      .catch(() => { });

    fetch("/api/product-attributes?page=1&pageSize=1000", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((r) => r.json())
      .then(({ attributes }) => setAttributeOptions(attributes))
      .catch(() => { });
  }, []);

  /* ---------------------------------------------------------- */
  /*  2b) Load terms when attribute changes                      */
  /* ---------------------------------------------------------- */
  useEffect(() => {
    // Clear terms when attribute is cleared
    if (!attributeFilter) {
      setTermOptions([]);
      setAttributeTermFilter("");
      return;
    }
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(
          `/api/product-attributes/${attributeFilter}/terms?page=1&pageSize=1000`,
          {
            headers: {
              "x-internal-secret": process.env.INTERNAL_API_SECRET!,
            },
            signal: controller.signal,
          }
        );
        if (!res.ok) throw new Error("Failed to load attribute terms");
        const { terms } = await res.json();
        setTermOptions(terms ?? []);
        // reset selected term when attribute changes
        setAttributeTermFilter("");
      } catch {
        /* ignore */
      }
    })();
    return () => controller.abort();
  }, [attributeFilter, onPageChange]);

  /* ---------------------------------------------------------- */
  /*  3) Stable callbacks (needed by columns)                   */
  /* ---------------------------------------------------------- */
  const handleDuplicateProduct = useCallback(
    async (productId: string) => {
      try {
        const res = await fetch(`/api/products/${productId}/duplicate`, {
          method: "POST",
        });
        if (!res.ok) throw new Error("Failed to duplicate product");
        toast.success("Product duplicated");
        mutate();
      } catch {
        toast.error("Failed to duplicate product");
      }
    },
    [mutate]
  );

  const handleStatusChange = useCallback(
    async (productId: string, newStatus: "published" | "draft") => {
      try {
        const res = await fetch(`/api/products/${productId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        if (!res.ok) throw new Error("Failed to update status");
        toast.success(`Status changed to ${newStatus}`);
        mutate();
      } catch {
        toast.error("Failed to update product status");
      }
    },
    [mutate]
  );

  /* ---------------------------------------------------------- */
  /*  4) Column definitions (memoised)                          */
  /* ---------------------------------------------------------- */
  const columns: ColumnDef<Product>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            className="h-4 w-4"
            checked={table.getIsAllRowsSelected()}
            aria-checked={
              table.getIsSomeRowsSelected()
                ? "mixed"
                : table.getIsAllRowsSelected()
            }
            onCheckedChange={(chk) => table.toggleAllRowsSelected(!!chk)}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            className="h-4 w-4"
            checked={row.getIsSelected()}
            aria-checked={
              row.getIsSomeSelected() ? "mixed" : row.getIsSelected()
            }
            onCheckedChange={(chk) => row.toggleSelected(!!chk)}
          />
        ),
        enableSorting: false,
      },
      {
        accessorKey: "image",
        header: "Image",
        cell: ({ row }) => {
          const { image, title } = row.original;
          const initials = title
            .split(" ")
            .slice(0, 2)
            .map((w) => w.charAt(0).toUpperCase())
            .join("")
            .slice(0, 2);
          return (
            <div className="relative h-12 w-12">
              {image ? (
                <Image
                  src={image}
                  alt={title}
                  fill
                  className="rounded-md object-cover"
                />
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 font-medium text-gray-600">
                  {initials}
                </div>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "title",
        // Make the title column sortable like "Created At"
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="px-0 hover:bg-transparent"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Product&nbsp;Title
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        sortingFn: "alphanumeric",
        cell: ({ row }) => (
          <div className="font-medium">{row.original.title}</div>
        ),
      },
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => <div className="text-sm">{row.original.sku}</div>,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => (
          <Select
            value={row.original.status}
            onValueChange={(val) =>
              handleStatusChange(row.original.id, val as "published" | "draft")
            }
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="published">
                <Badge
                  variant="outline"
                  className="border-green-200 bg-green-50 text-green-700"
                >
                  Published
                </Badge>
              </SelectItem>
              <SelectItem value="draft">
                <Badge
                  variant="outline"
                  className="border-gray-200 bg-gray-50 text-gray-700"
                >
                  Draft
                </Badge>
              </SelectItem>
            </SelectContent>
          </Select>
        ),
        filterFn: (row, _id, val) =>
          val === undefined || val === "all"
            ? true
            : row.original.status === val,
      },
      {
        accessorKey: "price",
        accessorFn: (p) => {
          const r = Number(p.maxRegularPrice ?? 0);
          const s = Number(p.maxSalePrice ?? NaN);
          const isSaleActive = Number.isFinite(s) && s > 0 && s < r;
          return isSaleActive ? s : r;
        },
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="px-0 hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Price
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const p = row.original;

          const reg = Number(p.maxRegularPrice ?? 0);
          const sale = Number(p.maxSalePrice ?? NaN);
          const isSaleActive = Number.isFinite(sale) && sale > 0 && sale < reg;
          const display = isSaleActive ? sale : reg;
          return (
            <div className="text-left">
              {display ? `$${display.toFixed(2)}` : "-"}
              {isSaleActive && (
                <span className="ml-2 text-sm text-gray-500 line-through">
                  ${reg.toFixed(2)}
                </span>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "stockStatus",
        header: "Stock Status",
        cell: ({ row }) => (
          <Badge
            variant="outline"
            className={
              row.original.stockStatus === "managed"
                ? "border-blue-200 bg-blue-50 text-blue-700"
                : "border-gray-200 bg-gray-50 text-gray-700"
            }
          >
            {row.original.stockStatus === "managed" ? "Managed" : "Unmanaged"}
          </Badge>
        ),
      },
      {
        accessorKey: "categories",
        header: "Categories",
        cell: ({ row }) => {
          const names = row.original.categories.map(
            (id) => categoryMap[id] ?? id
          );
          return (
            <div className="flex flex-wrap gap-1">
              {names.length ? (
                names.slice(0, 2).map((n, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {n}
                  </Badge>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  No categories
                </span>
              )}
              {names.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{names.length - 2}
                </Badge>
              )}
            </div>
          );
        },
        enableSorting: true,
        filterFn: (row, _id, val) => row.original.categories.includes(val),
      },
      {
        accessorKey: "attributes",
        header: "Attributes",
        cell: ({ row }) =>
          row.original.attributes.length ? (
            <div className="flex flex-wrap gap-1">
              {row.original.attributes.map((a) => (
                <Badge key={a.id} variant="secondary" className="text-xs">
                  {a.name}
                </Badge>
              ))}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        filterFn: (row, _id, val) =>
          row.original.attributes.some((a) => a.id === val),
      },
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="px-0 hover:bg-transparent"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            Created&nbsp;At
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const d = new Date(row.original.createdAt);
          return (
            <div className="text-sm">
              {!isNaN(d.getTime()) ? d.toLocaleDateString() : "-"}
            </div>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => {
          const p = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                {canUpdate && (
                  <DropdownMenuItem
                    onClick={() => router.push(`/products/${p.id}/edit`)}
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canUpdate && (
                  <DropdownMenuItem
                    onClick={() => handleDuplicateProduct(p.id)}
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {canDelete && <DropdownMenuSeparator />}
                {canDelete && (
                  <DropdownMenuItem
                    onClick={() => setDeleteProductId(p.id)}
                    className="text-red-600"
                  >
                    <Trash className="mr-2 h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
        enableSorting: true,
      },
    ],
    [
      categoryMap,
      canUpdate,
      canDelete,
      handleStatusChange,
      handleDuplicateProduct,
    ]
  );

  /* ---------------------------------------------------------- */
  /*  5) Table instance                                        */
  /* ---------------------------------------------------------- */
  const table = useReactTable({
    enableRowSelection: true,
    getRowId: (row) => row.id,
    data: products,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
  });

  /* ————————————————— react-table ⇆ server sort sync ———————————— */
  useEffect(() => {
    if (!sorting.length) return;
    const { id, desc } = sorting[0];
    // allow only columns we’ve whitelisted (includes "title" for alphabetical sort)
    const isOrderField = (col: string): col is OrderField =>
      ["createdAt", "updatedAt", "title", "sku"].includes(col);
    if (!isOrderField(id)) return;
    startTransition(() => {
      setServerSort({ field: id, dir: desc ? "desc" : "asc" });
      onPageChange(1); // reset to first page
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorting]);

  // Sync react-table page size with our prop
  useEffect(() => {
    table.setPageSize(pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  /* ---------------------------------------------------------- */
  /*  6) Bulk delete                                            */
  /* ---------------------------------------------------------- */
  const handleBulkDelete = useCallback(async () => {
    const ids = table.getSelectedRowModel().flatRows.map((r) => r.original.id);
    if (!ids.length) return;
    try {
      const res = await fetch("/api/products", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Deleted ${ids.length} product(s)`);
      setRowSelection({});
      mutate();
    } catch {
      toast.error("Failed to delete selected products");
    } finally {
      setBulkDeleteOpen(false);
    }
  }, [mutate, table]);

  /* ---------------------------------------------------------- */
  /*  7) Single-delete helper                                   */
  /* ---------------------------------------------------------- */
  const handleDeleteProduct = useCallback(async () => {
    if (!deleteProductId) return;
    try {
      const res = await fetch(`/api/products/${deleteProductId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Product deleted");
      mutate();
      setDeleteProductId(null);
    } catch {
      toast.error("Failed to delete product");
    }
  }, [deleteProductId, mutate]);

  /* ---------------------------------------------------------- */
  /*  8) Derived state & effects                                */
  /* ---------------------------------------------------------- */
  const selectedCount = useMemo(
    () => Object.values(rowSelection).filter(Boolean).length,
    [rowSelection]
  );

  useEffect(() => {
    setRowSelection({});
  }, [page, pageSize]);

  /* ---------------------------------------------------------- */
  /*  9) Permission gating                                      */
  /* ---------------------------------------------------------- */
  if (viewLoading) return null;
  if (!canView) {
    router.replace("/dashboard");
    return null;
  }

  /* ---------------------------------------------------------- */
  /*  10) Render                                                 */
  /* ---------------------------------------------------------- */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            placeholder="Search by title or SKU..."
            value={query}
            onChange={(e) => {
              const txt = e.target.value;
              startTransition(() => {
                setQuery(txt);
                onPageChange(1);
              });
            }}
            className="w-full sm:max-w-sm"
          />

          {/* Status filter */}
          <Select
            value={statusFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                setStatusFilter(
                  v === "all" ? "" : (v as "published" | "draft")
                );
                onPageChange(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>

          {/* Category filter */}
          <Select
            value={categoryFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                setCategoryFilter(v === "all" ? "" : v);
                onPageChange(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {categoryOptions.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Attribute filter */}
          <Select
            value={attributeFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                const next = v === "all" ? "" : v;
                setAttributeFilter(next);
                // Reset terms when attribute changes. Do NOT trigger filtering or pagination here.
                setTermOptions([]);
                setAttributeTermFilter("");
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by attribute" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Attributes</SelectItem>
              {attributeOptions.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Attribute Term filter (shown only when attribute selected) */}
          <Select
            value={attributeTermFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                setAttributeTermFilter(v === "all" ? "" : v);
                onPageChange(1);
              });
            }}
            disabled={!attributeFilter}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue
                placeholder={
                  attributeFilter ? "Filter by term" : "Select attribute first"
                }
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Terms</SelectItem>
              {termOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
              {!termOptions.length && attributeFilter && (
                /* Keep menu height consistent even if empty */
                <SelectItem value="__no_terms__" disabled>
                  No terms found
                </SelectItem>
              )}
            </SelectContent>
          </Select>

          {/* Page-size selector */}
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              startTransition(() => {
                onPageSizeChange(Number(v));
                onPageChange(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[100px]">
              <SelectValue placeholder="Page size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Bulk-delete button */}
        {canDelete && selectedCount > 0 && (
          <Button
            variant="destructive"
            onClick={() => setBulkDeleteOpen(true)}
            className="self-start sm:self-auto"
          >
            Delete Selected ({selectedCount})
          </Button>
        )}
      </div>

      {/* Bulk-delete confirmation dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected products?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount} product
              {selectedCount === 1 ? "" : "s"}. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDelete}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Table (standardized) */}
      <StandardDataTable<Product>
        table={table}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No products found."
        skeletonRows={5}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Showing {(page - 1) * pageSize + 1} to{" "}
          {Math.min(
            page * pageSize,
            (products.length ?? 0) + (page - 1) * pageSize
          )}{" "}
          of many entries
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.max(1, page - 1))}
            disabled={page <= 1 || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPageChange(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || isLoading}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Single-delete dialog */}
      <AlertDialog
        open={!!deleteProductId}
        onOpenChange={(open) => !open && setDeleteProductId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              product.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteProduct}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
