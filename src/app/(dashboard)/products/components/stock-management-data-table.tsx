// src/app/(dashboard)/products/components/stock-management-data-table.ts
"use client";

import {
  useState,
  useEffect,
  startTransition,
} from "react";
import { ArrowUpDown, Edit } from "lucide-react";
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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/ui/select";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useProducts } from "@/hooks/use-products";
import type { Product } from "../../components/products-data-table";
import { useDebounce } from "@/hooks/use-debounce";

const fetcher = (url: string) => fetch(url, {
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
  const { hasPermission: canView, isLoading: viewLoading } =
    useHasPermission(orgId, { stockManagement: ["view"] });
  const { hasPermission: canUpdate, isLoading: updateLoading } =
    useHasPermission(orgId, { stockManagement: ["update"] });

  // 2) Table state
  const [sorting, setSorting] = useState<SortingState>([{ id: "stock", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Search & filters (debounced search, plus category/attribute to match products table UX)
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [attributeFilter, setAttributeFilter] = useState<string>("");

  // 3) Ancillary data (categories & attributes) — same endpoints/headers as products table
  const [categoryOptions, setCategoryOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [attributeOptions, setAttributeOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [termOptions, setTermOptions] = useState<Array<{ id: string; name: string }>>([]);

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
      .catch(() => { /* silent */ });

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
      .catch(() => { /* silent */ });

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
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
          signal: controller.signal,
        }
      );
      if (!res.ok) throw new Error("Failed to load attribute terms");
      const { terms } = await res.json();
      setTermOptions(terms ?? []);
      setAttributeTermFilter("");
      startTransition(() => setPage(1));
    } catch {
      /* ignore */
    }
  })();
  return () => controller.abort();
}, [attributeFilter]);

  // 4) Data
  const { products, isLoading, totalPages, mutate } = useProducts({
    page,
    pageSize,
    search: debouncedSearch,
    categoryId: categoryFilter || undefined,
    attributeId: attributeFilter || undefined,
    attributeTermId: attributeTermFilter || undefined,
  });

  const { data: whData } = useSWR<{ warehouses: Warehouse[] }>("/api/warehouses", fetcher);
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
      cell: ({ row }) => <StockPopover product={row.original} />,
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

  // Stock popover component
  function StockPopover({ product }: { product: Product }) {
    const [editable, setEditable] = useState<Record<string, Record<string, number>>>({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
      const norm: Record<string, Record<string, number>> = {};
      for (const [wid, countries] of Object.entries(product.stockData || {})) {
        norm[wid] = {};
        for (const [c, q] of Object.entries(countries)) {
          norm[wid][c] = Number(q ?? 0);
        }
      }
      setEditable(norm);
    }, [product.stockData]);

    const handleChange = (wid: string, country: string, qty: number) => {
      setEditable((prev) => ({
        ...prev,
        [wid]: { ...(prev[wid] || {}), [country]: qty },
      }));
    };

    const handleSave = async () => {
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
      await fetch(`/api/products/${product.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseStock }),
      });
      await mutate();
      setSaving(false);
    };

    const editableSum = Object.values(editable).reduce(
      (sum, byCountry) =>
        sum + Object.values(byCountry).reduce((s, q) => s + q, 0),
      0
    );

    // Non-editable view
    if (!canUpdate) {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              {editableSum}
            </Button>
          </PopoverTrigger>
        </Popover>
      );
    }

    // Editable view
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            title="Click to update stock"
            className="flex items-center space-x-1"
          >
            <span>{editableSum}</span>
            <Edit className="h-4 w-4 text-gray-500" />
          </Button>
        </PopoverTrigger>
         <PopoverContent className="w-64">
   {/* Wrap inputs in a form so Enter submits/saves */}
   <form
     onSubmit={(e) => {
       e.preventDefault();
       if (!saving) {
         void handleSave();
       }
     }}
   >
     {warehouses.map((w) => (
       <div key={w.id} className="mb-4">
         <div className="mb-1 font-medium">{w.name}</div>
         {w.countries.map((c) => (
           <div
             key={c}
             className="mb-1 flex items-center justify-between"
           >
             <span className="text-sm">{c}</span>
             <Input
               type="number"
               min={0}
               className="w-20"
               value={editable[w.id]?.[c] ?? 0}
               onChange={(e) =>
                 handleChange(
                   w.id,
                   c,
                   parseInt(e.target.value, 10) || 0
                 )
               }
             />
           </div>
         ))}
       </div>
     ))}
     <Button className="w-full" type="submit" disabled={saving}>
       {saving ? "Saving…" : "Save"}
     </Button>
   </form>
 </PopoverContent>
      </Popover>
    );
  }

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
              setAttributeFilter(v === "all" ? "" : v);
              setPage(1);
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

                {/* Attribute Term filter (enabled only when an attribute is selected) */}
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
            {isLoading
              ? Array.from({ length: pageSize }).map((_, i) => (
                  <TableRow key={i}>
                    {table.getVisibleLeafColumns().map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : table.getRowModel().rows.length
              ? table.getRowModel().rows.map((row) => (
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
              : (
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
