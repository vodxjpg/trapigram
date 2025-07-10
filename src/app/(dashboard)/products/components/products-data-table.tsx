// src/app/(dashboard)/products/components/products-data-table.tsx
"use client";

import { useEffect, useState, useMemo, useCallback, startTransition } from "react";
import { useDebounce } from "@/hooks/use-debounce";   // ← add
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  type RowSelectionState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

/* ------------------------------------------------------------ */
/*  Product type definition                                     */
/* ------------------------------------------------------------ */
export type Product = {
  id: string;
  title: string;
  image: string | null;
  sku: string;
  status: "published" | "draft";
  regularPrice: Record<string, number>;
  salePrice: Record<string, number> | null;
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

export function ProductsDataTable() {
  /* ---------------------------------------------------------- */
  /*  1) Basic state & permissions                              */
  /* ---------------------------------------------------------- */
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { product: ["view"] },
  );
  const { hasPermission: canUpdate } = useHasPermission(orgId, {
    product: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(orgId, {
    product: ["delete"],
  });

  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  /** ----------------------------------------------------------------
   *  Search text
   *  ---------------------------------------------------------------- */
  const [query,     setQuery]     = useState("");   // bound to the <Input>
  const  debounced               = useDebounce(query, 300);
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null);

  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [categoryOptions, setCategoryOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [attributeOptions, setAttributeOptions] = useState<
    { id: string; name: string }[]
  >([]);
 
  const { products: productsRaw, isLoading, totalPages, mutate } = useProducts({
    page,
    pageSize,
    search: debounced,
  });

  const products = productsRaw ?? [];

  /* keep `page` within valid range */
  useEffect(() => {
    if (page > totalPages) setPage(Math.max(totalPages, 1));
  }, [totalPages, page]);

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
    [mutate],
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
    [mutate],
  );

  /* ---------------------------------------------------------- */
  /*  4) Column definitions (memoised)                          */
  /* ---------------------------------------------------------- */
  const columns: ColumnDef<Product>[] = useMemo(
    () => [
      /* ---------- selection column ---------- */
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            className="h-4 w-4"
            checked={table.getIsAllRowsSelected()}
            aria-checked={
              table.getIsSomeRowsSelected() ? "mixed" : table.getIsAllRowsSelected()
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
      /* ---------- image column ---------- */
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
      /* ---------- title column ---------- */
      {
        accessorKey: "title",
        header: "Product Title",
        cell: ({ row }) => <div className="font-medium">{row.original.title}</div>,
      },
      /* ---------- SKU column ---------- */
      {
        accessorKey: "sku",
        header: "SKU",
        cell: ({ row }) => <div className="text-sm">{row.original.sku}</div>,
      },
      /* ---------- status column ---------- */
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
          val === undefined || val === "all" ? true : row.original.status === val,
      },
      /* ---------- price column ---------- */
      {
        accessorKey: "price",
        accessorFn: (p) => {
          const country = Object.keys(p.regularPrice)[0] || "US";
          if (p.productType === "simple") {
            const sale = p.salePrice?.[country] ?? null;
            return sale ?? p.regularPrice[country] ?? 0;
          }
          const prices = p.variations.map((v) => {
            const sale = v.prices[country]?.sale ?? null;
            const reg = v.prices[country]?.regular ?? 0;
            return sale ?? reg;
          });
          return prices.length ? Math.max(...prices) : 0;
        },
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="px-0 hover:bg-transparent"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
          >
            Price
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const p = row.original;
          const country = Object.keys(p.regularPrice)[0] || "US";
          const display = (() => {
            if (p.productType === "simple") {
              return p.salePrice?.[country] ?? p.regularPrice[country] ?? 0;
            }
            const mx = p.variations.map((v) => {
              const sale = v.prices[country]?.sale ?? null;
              const reg = v.prices[country]?.regular ?? 0;
              return sale ?? reg;
            });
            return mx.length ? Math.max(...mx) : 0;
          })();
          return (
            <div className="text-left">
              {display ? `$${display.toFixed(2)}` : "-"}
              {p.productType === "simple" && p.salePrice?.[country] !== null && (
                <span className="ml-2 text-sm text-gray-500 line-through">
                  ${p.regularPrice[country]?.toFixed(2)}
                </span>
              )}
            </div>
          );
        },
      },
      /* ---------- stock status column ---------- */
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
      /* ---------- categories column ---------- */
      {
        accessorKey: "categories",
        header: "Categories",
        cell: ({ row }) => {
          const names = row.original.categories.map(
            (id) => categoryMap[id] ?? id,
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
      /* ---------- attributes column ---------- */
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
      /* ---------- created-at column ---------- */
      {
        accessorKey: "createdAt",
        header: ({ column }) => (
          <Button
            variant="ghost"
            className="px-0 hover:bg-transparent"
            onClick={() =>
              column.toggleSorting(column.getIsSorted() === "asc")
            }
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
      /* ---------- actions column ---------- */
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
    ],
  );

  /* ---------------------------------------------------------- */
  /*  5) Table instance (call hook every render)                */
  /* ---------------------------------------------------------- */
  const table = useReactTable({
    enableRowSelection: true,
    getRowId: (row) => row.id,
    data: products,
    columns,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    state: { sorting, columnFilters, columnVisibility, rowSelection },
  });


  /* ---------------------------------------------------------- */
  /*  6) Bulk delete (needs `table`)                             */
  /* ---------------------------------------------------------- */
  const handleBulkDelete = useCallback(async () => {
    const ids = table
      .getSelectedRowModel()
      .flatRows.map((r) => r.original.id);
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
    [rowSelection],
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
          placeholder="Search products..."
          value={query}
          onChange={(e) => {
            const txt = e.target.value;
            startTransition(() => {
              setQuery(txt);   // instant UI update
              setPage(1);      // reset page without blocking paint
            });
          }}
          className="w-full sm:max-w-sm"
          />

          {/* Status filter */}
          <Select
            value={
              (table.getColumn("status")?.getFilterValue() as string) ?? "all"
            }
            onValueChange={(value) => {
              const col = table.getColumn("status");
              if (!col) return;
              col.setFilterValue(value === "all" ? undefined : value);
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
            value={
              (table.getColumn("categories")?.getFilterValue() as string) ??
              "all"
            }
            onValueChange={(value) => {
              const col = table.getColumn("categories");
              if (!col) return;
              col.setFilterValue(value === "all" ? undefined : value);
              setPage(1);
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
            value={
              (table.getColumn("attributes")?.getFilterValue() as string) ??
              "all"
            }
            onValueChange={(value) => {
              const col = table.getColumn("attributes");
              if (!col) return;
              col.setFilterValue(value === "all" ? undefined : value);
              setPage(1);
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

          {/* Page-size selector */}
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
                 startTransition(() => {
                     setPageSize(Number(v));
                     setPage(1);
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

        {/* Bulk-delete button (OUTSIDE any <Select>) */}
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

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, r) => (
                <TableRow key={r}>
                  {Array.from({ length: columns.length }).map((_, c) => (
                    <TableCell key={c}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No products found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Showing {(page - 1) * pageSize + 1} to{" "}
                    {Math.min(
            page * pageSize,
            (products.length ?? 0) + (page - 1) * pageSize,
         )}{" "}
         of
          many entries
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1 || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
