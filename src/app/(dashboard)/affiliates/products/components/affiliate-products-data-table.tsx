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

/** Normalize the different possible shapes of pointsPrice into { regular, sale } for the first available country */
function pickFirstRegularSale(pointsPrice: unknown): { regular: number; sale: number | null } | null {
  if (!pointsPrice || typeof pointsPrice !== "object") return null
  const top = pointsPrice as Record<string, unknown>
  const topKeys = Object.keys(top)
  if (!topKeys.length) return null

  // Case A: per-country object  { US: { regular, sale }, AE: {…} }
  const firstVal = top[topKeys[0]]
  if (firstVal && typeof firstVal === "object" && "regular" in (firstVal as any)) {
    const { regular = 0, sale = null } = firstVal as { regular?: number; sale?: number | null }
    return { regular: Number(regular) || 0, sale: sale == null ? null : Number(sale) }
  }

  // Case B: old shape per-country number { US: 120, AE: 90 }
  if (typeof firstVal === "number") {
    return { regular: Number(firstVal) || 0, sale: null }
  }

  // Case C: per-level → per-country  { default: { US: { regular, sale }, … }, <levelId>: { … } }
  const levelMap = (top as any).default ?? top[topKeys[0]]
  if (levelMap && typeof levelMap === "object") {
    const lvl = levelMap as Record<string, unknown>
    const countries = Object.keys(lvl)
    if (!countries.length) return null
    const v = lvl[countries[0]]
    if (v && typeof v === "object" && "regular" in (v as any)) {
      const { regular = 0, sale = null } = v as { regular?: number; sale?: number | null }
      return { regular: Number(regular) || 0, sale: sale == null ? null : Number(sale) }
    }
    if (typeof v === "number") {
      return { regular: Number(v) || 0, sale: null }
    }
  }

  return null
}

export function AffiliateProductsDataTable() {
  const router = useRouter()
  const { products, mutate, isLoading } = useAffiliateProducts()

  const [sorting, setSorting] = useState<SortingState>([])
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!deleteId) return
    try {
      const res = await fetch(`/api/affiliate/products/${deleteId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Affiliate product deleted")
      mutate()
    } catch {
      toast.error("Failed to delete")
    } finally {
      setDeleteId(null)
    }
  }

  const columns: ColumnDef<AffiliateProduct>[] = [
    {
      accessorKey: "image",
      header: "Image",
      cell: ({ row }) => {
        const { image, title } = row.original
        const initials = title
          .split(" ")
          .slice(0, 2)
          .map((w) => w[0]?.toUpperCase() ?? "")
          .join("")
        return (
          <div className="relative h-10 w-10">
            {image ? (
              <Image src={image} alt={title} fill className="object-cover rounded-md" />
            ) : (
              <div className="h-10 w-10 flex items-center justify-center rounded-full bg-gray-200 text-xs text-gray-600">
                {initials || "–"}
              </div>
            )}
          </div>
        )
      },
    },
    { accessorKey: "title", header: "Title" },
    { accessorKey: "sku", header: "SKU" },

    // Points column — safe across all shapes
    {
      accessorKey: "pointsPrice",
      header: "Points",
      cell: ({ row }) => {
        const rs = pickFirstRegularSale(row.original.pointsPrice as unknown)
        if (!rs) return "-"
        const { regular, sale } = rs
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
        )
      },
    },

    {
      accessorKey: "productType",
      header: "Type",
      cell: ({ row }) => <Badge variant="secondary">{row.original.productType}</Badge>,
    },

    {
      id: "actions",
      cell: ({ row }) => {
        const product = row.original
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
              <DropdownMenuItem onClick={() => router.push(`/affiliates/products/${product.id}`)}>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteId(product.id)} className="text-red-600">
                <Trash className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

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

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={handleDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
