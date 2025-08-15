// src/app/(dashboard)/products/components/stock-management-data-table.ts
"use client";

import { useState, useEffect, useMemo, startTransition } from "react";
import { ArrowUpDown, Edit, X } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
} from "@tanstack/react-table";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import {
  Drawer,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer";
import { Separator } from "@/components/ui/separator";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useProducts } from "@/hooks/use-products";
import type { Product } from "../../components/products-data-table";
import { useDebounce } from "@/hooks/use-debounce";

const fetcher = (url: string) =>
  fetch(url, {
    headers: {
      "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
    },
  }).then((res) => res.json());

interface Warehouse {
  id: string;
  name: string;
  countries: string[];
}

export function StockManagementDataTable() {
  const router = useRouter();

  // 1) Active org & permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { stockManagement: ["view"] }
  );
  const { hasPermission: canUpdate, isLoading: updateLoading } =
    useHasPermission(orgId, { stockManagement: ["update"] });

  // 2) Table state
  const [sorting, setSorting] = useState<SortingState>([
    { id: "stock", desc: false },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Search & filters
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [attributeFilter, setAttributeFilter] = useState<string>("");
  const [attributeTermFilter, setAttributeTermFilter] = useState<string>("");

  // 3) Ancillary data (categories & attributes)
  const [categoryOptions, setCategoryOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [attributeOptions, setAttributeOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [termOptions, setTermOptions] = useState<
    Array<{ id: string; name: string }>
  >([]);

  useEffect(() => {
    let mounted = true;

    fetch("/api/product-categories?page=1&pageSize=1000", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((r) => r.json())
      .then(({ categories }) => {
        if (!mounted) return;
        setCategoryOptions(categories ?? []);
      })
      .catch(() => {});

    fetch("/api/product-attributes?page=1&pageSize=1000", {
      headers: {
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
      },
    })
      .then((r) => r.json())
      .then(({ attributes }) => {
        if (!mounted) return;
        setAttributeOptions(attributes ?? []);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  // Load terms whenever attribute changes
  useEffect(() => {
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
              "x-internal-secret":
                process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
            },
            signal: controller.signal,
          }
        );
        if (!res.ok) throw new Error("Failed to load attribute terms");
        const { terms } = await res.json();
        setTermOptions(terms ?? []);
        setAttributeTermFilter("");
      } catch {}
    })();
    return () => controller.abort();
  }, [attributeFilter]);

  // 4) Data — IMPORTANT: only filter when a term is chosen
  const { products, isLoading, totalPages, mutate } = useProducts({
    page,
    pageSize,
    search: debouncedSearch,
    categoryId: categoryFilter || undefined,
    attributeTermId: attributeTermFilter || undefined,
  });

  const { data: whData } = useSWR<{ warehouses: Warehouse[] }>(
    "/api/warehouses",
    fetcher
  );
  const warehouses = whData?.warehouses || [];

  // 5) Columns
  const columns: ColumnDef<Product>[] = [
    {
      id: "image",
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
          <div className="relative h-10 w-10">
            {image ? (
              <Image
                src={image}
                alt={title}
                fill
                className="object-cover rounded-md"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200 font-medium text-gray-600">
                {initials}
              </div>
            )}
          </div>
        );
      },
    },
    { accessorKey: "title", header: "Product Title" },
    { accessorKey: "sku", header: "SKU" },
    {
      id: "stock",
      header: ({ column }) => (
        <Button
          variant="ghost"
          className="px-0 hover:bg-transparent"
          onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        >
          Stock
          <ArrowUpDown className="ml-1 h-3 w-3" />
        </Button>
      ),
      accessorFn: (row) =>
        Object.values(row.stockData || {}).reduce(
          (sum, byCountry) =>
            sum + Object.values(byCountry).reduce((s, q) => s + Number(q), 0),
          0
        ),
      cell: ({ row }) => (
        <StockDrawer
          product={row.original}
          warehouses={warehouses}
          canUpdate={canUpdate}
          onSaved={async () => {
            await mutate();
          }}
        />
      ),
      enableSorting: true,
      sortingFn: "basic",
    },
  ];

  // 6) Table setup
  const table = useReactTable({
    data: products || [],
    columns,
    state: { sorting, columnFilters, columnVisibility },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // 7) Keep react-table page size in sync with our state
  useEffect(() => {
    table.setPageSize(pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize]);

  // 8) Redirect if no view permission
  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/products");
  }, [viewLoading, canView, router]);

  if (viewLoading || updateLoading || !canView) return null;

  // Render
  return (
    <div className="space-y-4">
      {/* Toolbar — search + filters + page-size */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          placeholder="Search products..."
          value={search}
          onChange={(e) => {
            const txt = e.target.value;
            startTransition(() => {
              setSearch(txt);
              setPage(1);
            });
          }}
          className="w-full sm:max-w-sm"
        />

        {/* Category filter */}
        <Select
          value={categoryFilter || "all"}
          onValueChange={(v) => {
            startTransition(() => {
              setCategoryFilter(v === "all" ? "" : v);
              setPage(1);
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

        {/* Attribute Term filter */}
        <Select
          value={attributeTermFilter || "all"}
          onValueChange={(v) => {
            startTransition(() => {
              setAttributeTermFilter(v === "all" ? "" : v);
              setPage(1);
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
              Array.from({ length: pageSize }).map((_, i) => (
                <TableRow key={i}>
                  {table.getVisibleLeafColumns().map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={table.getVisibleLeafColumns().length}
                  className="py-6 text-center"
                >
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
            (products?.length ?? 0) + (page - 1) * pageSize
          )}{" "}
          of many entries
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || isLoading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || isLoading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer used for editing stock                                      */
/* ------------------------------------------------------------------ */
function StockDrawer({
  product,
  warehouses,
  canUpdate,
  onSaved,
}: {
  product: Product;
  warehouses: Warehouse[];
  canUpdate: boolean;
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editable, setEditable] = useState<
    Record<string, Record<string, number>>
  >({});

  // Initialize editable map from product.stockData
  useEffect(() => {
    const norm: Record<string, Record<string, number>> = {};
    for (const [wid, countries] of Object.entries(product.stockData || {})) {
      norm[wid] = {};
      for (const [c, q] of Object.entries(countries)) {
        norm[wid][c] = Number(q ?? 0);
      }
    }
    // Ensure every warehouse/country combo is present so inputs always show
    for (const w of warehouses) {
      if (!norm[w.id]) norm[w.id] = {};
      for (const c of w.countries) {
        if (norm[w.id][c] === undefined) norm[w.id][c] = 0;
      }
    }
    setEditable(norm);
  }, [product.stockData, warehouses]);

  const totalQty = useMemo(
    () =>
      Object.values(editable).reduce(
        (sum, byCountry) =>
          sum + Object.values(byCountry).reduce((s, q) => s + q, 0),
        0
      ),
    [editable]
  );

  const handleChange = (wid: string, country: string, qty: number) => {
    setEditable((prev) => ({
      ...prev,
      [wid]: { ...(prev[wid] || {}), [country]: qty },
    }));
  };

  const blurActiveElement = () => {
    if (typeof document !== "undefined") {
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  };

  const handleSave = async () => {
    blurActiveElement(); // iOS/Safari focus quirk
    if (!canUpdate || saving) return;
    setSaving(true);

    const warehouseStock = Object.entries(editable).flatMap(
      ([warehouseId, countries]) =>
        Object.entries(countries).map(([country, quantity]) => ({
          warehouseId,
          productId: product.id,
          variationId: null,
          country,
          quantity,
        }))
    );

    try {
      await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseStock }),
      });
      await onSaved();
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  // Read-only trigger if cannot update
  if (!canUpdate) {
    return (
      <Button variant="outline" size="sm" disabled>
        {totalQty}
      </Button>
    );
  }

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          title="Click to update stock"
          className="flex items-center space-x-1"
        >
          <span>{totalQty}</span>
          <Edit className="h-4 w-4 text-gray-500" />
        </Button>
      </DrawerTrigger>

      {/* Force bottom-sheet on ALL breakpoints with height & rounded top */}
      <DrawerContent
        className="
          fixed inset-x-0 bottom-0 top-auto w-full
          rounded-t-2xl border-t bg-background p-0
          data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-10
          data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom-10
          h-[85vh] sm:h-[85vh]
        "
      >
        <DrawerHeader className="px-6 py-4">
          <div className="flex items-center justify-between">
            <DrawerTitle className="text-base sm:text-lg">
              Edit Stock — <span className="font-normal">{product.title}</span>
            </DrawerTitle>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-5 w-5" />
              </Button>
            </DrawerClose>
          </div>
          <DrawerDescription className="mt-1">
            Update quantities per warehouse and country. Total:{" "}
            <span className="font-medium">{totalQty}</span>
          </DrawerDescription>
        </DrawerHeader>

        <Separator />

        {/* Scrollable content area */}
        <div className="overflow-y-auto px-6 py-4 h-[calc(85vh-9rem)] sm:h-[calc(85vh-9rem)]">
          {warehouses.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No warehouses found.
            </p>
          ) : (
            <div className="space-y-6">
              {warehouses.map((w) => (
                <div key={w.id} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium">{w.name}</h3>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditable((prev) => {
                            const next = { ...prev };
                            const block = { ...(next[w.id] || {}) };
                            w.countries.forEach((c) => (block[c] = 0));
                            next[w.id] = block;
                            return next;
                          })
                        }
                      >
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {w.countries.map((c) => (
                      <div
                        key={`${w.id}-${c}`}
                        className="flex items-center justify-between rounded-md border p-3"
                      >
                        <span className="text-sm">{c}</span>
                        <Input
                          inputMode="numeric"
                          type="number"
                          min={0}
                          className="ml-3 w-24"
                          value={editable[w.id]?.[c] ?? 0}
                          onChange={(e) =>
                            handleChange(
                              w.id,
                              c,
                              Number.parseInt(e.target.value, 10) || 0
                            )
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSave();
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <Separator />

        <DrawerFooter className="px-6 py-4">
          <div className="flex items-center justify-end gap-2">
            <DrawerClose asChild>
              <Button variant="outline">Cancel</Button>
            </DrawerClose>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}
