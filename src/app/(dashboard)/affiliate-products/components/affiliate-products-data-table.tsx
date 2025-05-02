// src/app/(dashboard)/affiliate-products/components/affiliate-products-data-table.tsx
"use client"

import { useState } from "react"
import {
  useReactTable,
  type ColumnDef,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
} from "@tanstack/react-table"
import Image from "next/image"
import { useRouter } from "next/navigation"
import { Edit, MoreHorizontal, Trash } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { useAffiliateProducts, type AffiliateProduct } from "@/hooks/use-affiliate-products"

export function AffiliateProductsDataTable() {
  const router = useRouter()
  const { products, mutate, isLoading } = useAffiliateProducts()

  const [sorting, setSorting] = useState<SortingState>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)

  /* ------------------------------------------------------------------
     delete helper
  ------------------------------------------------------------------ */
  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/affiliate-products/${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Affiliate product deleted")
      mutate()
    } catch {
      toast.error("Failed to delete")
    } finally {
      setDeleteId(null)
    }
  }

  /* ------------------------------------------------------------------
   columns
------------------------------------------------------------------ */
const columns: ColumnDef<AffiliateProduct>[] = [
  /* ------------ Image ------------------------------------------------ */
  {
    accessorKey: "image",
    header: "Image",
    cell: ({ row }) => {
      const { image, title } = row.original;
      const initials = title
        .split(" ")
        .slice(0, 2)
        .map((w) => w[0].toUpperCase())
        .join("");
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
            <div className="h-10 w-10 flex items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600">
              {initials}
            </div>
          )}
        </div>
      );
    },
  },

  /* ------------ basic fields ---------------------------------------- */
  { accessorKey: "title", header: "Title" },
  { accessorKey: "sku",   header: "SKU"  },

  /* ------------ Points (show regular / sale of 1st country) ---------- */
  {
    accessorKey: "pointsPrice",
    header: "Points",
    cell: ({ row }) => {
      const map = row.original.pointsPrice ?? {};
      const firstCountry = Object.keys(map)[0];
      if (!firstCountry) return "-";

      const { regular, sale } = map[firstCountry];
      return (
        <span>
          {sale != null ? (
            <>
              <s className="text-muted-foreground">{regular}</s>&nbsp;
              <span className="font-medium text-red-600">{sale}</span>
            </>
          ) : (
            regular
          )}
        </span>
      );
    },
  },

  /* ------------ Type badge ------------------------------------------ */
  {
    accessorKey: "productType",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="secondary">{row.original.productType}</Badge>
    ),
  },

  /* ------------ Actions --------------------------------------------- */
  {
    id: "actions",
    cell: ({ row }) => {
      const product = row.original;
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
            <DropdownMenuItem
              onClick={() => router.push(`/affiliate-products/${product.id}`)}
            >
              <Edit className="h-4 w-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDeleteId(product.id)}
              className="text-red-600"
            >
              <Trash className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];


  const table = useReactTable({
    data: products,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })

  if (isLoading) return <p className="text-muted-foreground">Loading…</p>
  if (!products.length) return <p className="text-muted-foreground">No products.</p>

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((h) => (
                  <TableHead key={h.id}>
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* simple prev/next */}
      <div className="flex justify-end gap-2 mt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
        >
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
        >
          Next
        </Button>
      </div>

      {/* delete confirm */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
