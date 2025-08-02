// src/app/(dashboard)/billing/components/invoices-data-table.tsx
"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  type ColumnDef,
} from "@tanstack/react-table";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Invoice {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalAmount: number;
  paidAmount: number;
  status: string;
  dueDate: string;
  createdAt: string;
}

interface InvoicesResponse {
  items: Array<
    Omit<Invoice, "totalAmount" | "paidAmount"> & {
      totalAmount: string;
      paidAmount: string;
    }
  >;
  meta: { total: number; pages: number; page: number; limit: number };
}

interface InvoicesDataTableProps {
  page: number;
  pageSize: number;
  onPageChange: (p: number) => void;
  onPageSizeChange: (n: number) => void;
}

export function InvoicesDataTable({
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: InvoicesDataTableProps) {
  const router = useRouter();

  // 1) Data fetching + loading / totalPages
  const [data, setData] = useState<Invoice[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    async function fetchInvoices() {
      setIsLoading(true);
      const res = await fetch(
        `/api/invoices?page=${page}&limit=${pageSize}`,
        {
          credentials: "include",
        }
      );
      if (res.ok) {
        const json = (await res.json()) as InvoicesResponse;
        const items = json.items.map((i) => ({
          ...i,
          totalAmount: parseFloat(i.totalAmount),
          paidAmount: parseFloat(i.paidAmount),
        }));
        setData(items);
        setTotalPages(json.meta.pages);
      }
      setIsLoading(false);
    }
    fetchInvoices();
  }, [page, pageSize]);

  // 2) Columns
  const columns = useMemo<ColumnDef<Invoice>[]>(
    () => [
      {
        id: "period",
        header: "Period",
        cell: ({ row }) => (
          <>
            {row.original.periodStart} &rarr; {row.original.periodEnd}
          </>
        ),
      },
      {
        accessorKey: "totalAmount",
        header: "Total",
        cell: ({ row }) => `$${row.original.totalAmount.toFixed(2)}`,
      },
      {
        accessorKey: "paidAmount",
        header: "Paid",
        cell: ({ row }) => `$${row.original.paidAmount.toFixed(2)}`,
      },
      {
        id: "pending",
        header: "Pending",
        cell: ({ row }) => {
          const { totalAmount, paidAmount } = row.original;
          return `$${(totalAmount - paidAmount).toFixed(2)}`;
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const s = row.original.status;
          const variant =
            s === "paid"
              ? "secondary"
              : s === "underpaid"
              ? "destructive"
              : "outline";
          return <Badge variant={variant}>{s}</Badge>;
        },
      },
      {
        accessorKey: "dueDate",
        header: "Due",
      },
      {
        accessorKey: "createdAt",
        header: "Created",
        cell: ({ row }) =>
          new Date(row.original.createdAt).toLocaleDateString(),
      },
      {
        id: "actions",
        header: "Action",
        cell: ({ row }) => (
          <Button
            variant="link"
            onClick={() => router.push(`/billing/${row.original.id}`)}
          >
            View
          </Button>
        ),
      },
    ],
    [router]
  );

  // 3) Table instance
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* page‐size selector */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>Show</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>per page</span>
        </div>
      </div>

      {/* table */}
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
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={columns.length}>
                    <Skeleton className="h-6 w-full" />
                  </TableCell>
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
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  No invoices found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* pagination */}
      <div className="flex items-center justify-between space-x-2 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(Math.max(1, page - 1))}
          disabled={page <= 1 || isLoading}
        >
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
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
  );
}
