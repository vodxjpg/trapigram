// src/app/(dashboard)/products/components/stock-management-data-table.tsx
"use client";

import { useState, useEffect } from "react";
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
import { useProducts } from "@/hooks/use-products";
import { usePermission } from "@/hooks/use-permission";
import type { Product } from "../../components/products-data-table";

const fetcher = (url: string) => fetch(url).then((res) => res.json());

interface Warehouse {
  id: string;
  name: string;
  countries: string[];
}

export function StockManagementDataTable() {
  const router = useRouter();
  const can = usePermission();

  const [sorting, setSorting] = useState<SortingState>([{ id: "stock", desc: false }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState("");

  const { products, isLoading, totalPages, mutate } = useProducts({ page, pageSize, search });
  const { data: whData } = useSWR<{ warehouses: Warehouse[] }>(
    "/api/warehouses",
    fetcher
  );
  const warehouses = whData?.warehouses || [];

  // redirect if no view permission
  useEffect(() => {
    if (!can.loading && !can({ stockManagement: ["view"] })) {
      router.replace("/products");
    }
  }, [can, router]);
  if (can.loading || !can({ stockManagement: ["view"] })) return null;

  /* ------------------------------------------------------------ */
  /*  Stock-popover (per-row), only editable if they have update  */
  /* ------------------------------------------------------------ */
  function StockPopover({ product }: { product: Product }) {
    const canUpdate = can({ stockManagement: ["update"] });
    const [editable, setEditable] = useState<Record<string, Record<string, number>>>({});
    const [saving, setSaving] = useState(false);

    // normalize incoming data
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
      const warehouseStock = Object.entries(editable).flatMap(([warehouseId, countries]) =>
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

    // if they can't update, just show the sum:
    if (!canUpdate) {
      return (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm">
              {editableSum}
            </Button>
          </PopoverTrigger>
        </Popover>
      );
    }

    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm">
            {editableSum}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64">
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
                      handleChange(w.id, c, parseInt(e.target.value) || 0)
                    }
                  />
                </div>
              ))}
            </div>
          ))}
          <Button
            className="w-full"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </PopoverContent>
      </Popover>
    );
  }

  /* ------------------------------------------------------------ */
  /*  Columns                                                     */
  /* ------------------------------------------------------------ */
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
      header: "Stock",
      accessorFn: (row) =>
        Object.values(row.stockData || {}).reduce(
          (sum, byCountry) =>
            sum + Object.values(byCountry).reduce((s, q) => s + Number(q), 0),
          0
        ),
      cell: ({ row }) => <StockPopover product={row.original} />,
      sortingFn: "basic",
    },
  ];

  /* ------------------------------------------------------------ */
  /*  Table instance                                              */
  /* ------------------------------------------------------------ */
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

  /* ------------------------------------------------------------ */
  /*  Render                                                      */
  /* ------------------------------------------------------------ */
  return (
    <div className="space-y-4">
      <Input
        placeholder="Search products..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-sm"
      />
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder
                      ? null
                      : flexRender(
                          h.column.columnDef.header,
                          h.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading
              ? Array.from({ length: pageSize }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((_, j) => (
                      <TableCell key={j}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : table.getRowModel().rows.length
              ? table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row
                      .getVisibleCells()
                      .map((cell) => (
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
                    colSpan={columns.length}
                    className="py-6 text-center"
                  >
                    No products found.
                  </TableCell>
                </TableRow>
              )}
          </TableBody>
        </Table>
      </div>
      <div className="flex justify-between py-4">
        <Button
          variant="outline"
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 1 || isLoading}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          onClick={() => setPage((p) => p + 1)}
          disabled={page === totalPages || isLoading}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
