// src/components/data-table/data-table.tsx
"use client";

import {
  flexRender,
  type ColumnDef,
  type Table as ReactTable,
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import * as React from "react";

export type StandardDataTableProps<TData> = {
  /** A TanStack table instance created with useReactTable in the parent */
  table: ReactTable<TData>;
  /** The same columns you used to create the table (for counts/empty states) */
  // Widen TValue to `any` to support heterogenous accessor value types safely.
  columns: ColumnDef<TData, any>[];
  /** Show loading skeleton rows when true */
  isLoading?: boolean;
  /** Number of skeleton rows to show while loading */
  skeletonRows?: number;
  /** Text to display when there is no data */
  emptyMessage?: string;
  /** Optional className for the outer wrapper */
  className?: string;
};

/**
 * StandardDataTable
 * Pure presentational component that renders a consistent table UI
 * (header/body/loading/empty). It relies on an external TanStack table instance.
 */
export function StandardDataTable<TData>({
  table,
  columns,
  isLoading = false,
  skeletonRows = 5,
  emptyMessage = "No records found.",
  className,
}: StandardDataTableProps<TData>) {
  const columnCount = columns.length;

  return (
    <div className={`rounded-md border overflow-x-auto ${className ?? ""}`}>
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
            Array.from({ length: skeletonRows }).map((_, r) => (
              <TableRow key={`skeleton-${r}`}>
                {Array.from({ length: columnCount }).map((_, c) => (
                  <TableCell key={`skeleton-cell-${r}-${c}`}>
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
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext(),
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columnCount} className="h-24 text-center">
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
