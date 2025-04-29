"use client"

import { useState } from "react"
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useRouter } from "next/navigation"
import { Copy, Edit, MoreHorizontal, Trash } from "lucide-react"
import Image from "next/image"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
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
import { Skeleton } from "@/components/ui/skeleton"
import { useProducts } from "@/hooks/use-products"
import type { Attribute } from "@/types/product"

// Product type definition
export type Product = {
  id: string
  title: string
  image: string | null
  sku: string
  status: "published" | "draft"
  regularPrice: Record<string, number>
  salePrice: Record<string, number> | null
  stockStatus: "managed" | "unmanaged"
  stockData: Record<string, Record<string, number>> | null
  categories: string[]
  attributes: Attribute[]
  createdAt: string
  productType: "simple" | "variable"
  variations: Array<{
    id: string
    attributes: Record<string, string>
    sku: string
    image: string | null
    prices: Record<string, { regular: number; sale: number | null }>
    cost: Record<string, number>
    stock: Record<string, Record<string, number>>
  }>
}

export function ProductsDataTable() {
  const router = useRouter()
  const [sorting, setSorting] = useState<SortingState>([])
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})
  const [rowSelection, setRowSelection] = useState({})
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState("")
  const [deleteProductId, setDeleteProductId] = useState<string | null>(null)

  const { products, isLoading, totalPages, mutate } = useProducts({
    page,
    pageSize,
    search,
  })

  /* ------------------------------------------------------------ */
  /*  NEW – duplicate handler                                     */
  /* ------------------------------------------------------------ */
  const handleDuplicateProduct = async (productId: string) => {
    try {
      const res = await fetch(`/api/products/${productId}/duplicate`, { method: "POST" })
      if (!res.ok) throw new Error("Failed to duplicate product")
      toast.success("Product duplicated")
      mutate()
    } catch (err) {
      toast.error("Failed to duplicate product")
    }
  }

  const handleStatusChange = async (productId: string, newStatus: "published" | "draft") => {
    try {
      const response = await fetch(`/api/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      })
      if (!response.ok) throw new Error("Failed to update product status")
      toast.success(`Product status changed to ${newStatus}`)
      mutate()
    } catch (error) {
      toast.error("Failed to update product status")
    }
  }

  const handleDeleteProduct = async () => {
    if (!deleteProductId) return
    try {
      const response = await fetch(`/api/products/${deleteProductId}`, { method: "DELETE" })
      if (!response.ok) throw new Error("Failed to delete product")
      toast.success("The product has been deleted successfully")
      mutate()
      setDeleteProductId(null)
    } catch (error) {
      toast.error("Failed to delete product")
    }
  }

  const columns: ColumnDef<Product>[] = [
    {
      accessorKey: "image",
      header: "Image",
      cell: ({ row }) => {
        const image = row.original.image
        const title = row.original.title
        const initials = title
          .split(" ")
          .slice(0, 2)
          .map((word) => word.charAt(0).toUpperCase())
          .join("")
          .slice(0, 2)
        return (
          <div className="relative h-12 w-12">
            {image ? (
              <Image src={image} alt={title} fill className="rounded-md object-cover" />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-200 font-medium text-gray-600">
                {initials}
              </div>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "title",
      header: "Product Title",
      cell: ({ row }) => <div className="font-medium">{row.original.title}</div>,
    },
    {
      accessorKey: "sku",
      header: "SKU",
      cell: ({ row }) => <div className="text-sm">{row.original.sku}</div>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const status = row.original.status
        return (
          <Select
            value={status}
            onValueChange={(value) => handleStatusChange(row.original.id, value as "published" | "draft")}
          >
            <SelectTrigger className="w-[110px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="published">
                <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                  Published
                </Badge>
              </SelectItem>
              <SelectItem value="draft">
                <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700">
                  Draft
                </Badge>
              </SelectItem>
            </SelectContent>
          </Select>
        )
      },
      filterFn: (row, id, value) => value.includes(row.original.status),
    },
    {
      accessorKey: "price",
      header: "Prices",
      cell: ({ row }) => {
        const product = row.original
        const country = Object.keys(product.regularPrice)[0] || "US"

        if (product.productType === "simple") {
          const salePrice = product.salePrice?.[country] ?? null
          const regularPrice = product.regularPrice[country] ?? 0
          const displayPrice = salePrice !== null ? salePrice : regularPrice
          return (
            <div className="text-left">
              {displayPrice ? `$${displayPrice.toFixed(2)}` : "-"}
              {salePrice !== null && (
                <span className="ml-2 text-sm text-gray-500 line-through">${regularPrice.toFixed(2)}</span>
              )}
            </div>
          )
        }

        /* variable */
        const variationPrices = product.variations.map((v) => {
          const salePrice = v.prices[country]?.sale ?? null
          const regularPrice = v.prices[country]?.regular ?? 0
          return salePrice !== null ? salePrice : regularPrice
        })
        const maxPrice = variationPrices.length ? Math.max(...variationPrices) : 0
        return <div className="text-left">{maxPrice ? `$${maxPrice.toFixed(2)}` : "-"}</div>
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
        const categories = row.original.categories
        return (
          <div className="flex flex-wrap gap-1">
            {categories.length ? (
              categories.slice(0, 2).map((c, i) => (
                <Badge key={i} variant="secondary" className="text-xs">
                  {c}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">No categories</span>
            )}
            {categories.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{categories.length - 2}
              </Badge>
            )}
          </div>
        )
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created At",
      cell: ({ row }) => {
        const d = new Date(row.original.createdAt)
        return <div className="text-sm">{!isNaN(d.getTime()) ? d.toLocaleDateString() : "-"}</div>
      },
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
              <DropdownMenuItem onClick={() => router.push(`/products/${product.id}/edit`)}>
                <Edit className="mr-2 h-4 w-4" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleDuplicateProduct(product.id)}>
                <Copy className="mr-2 h-4 w-4" />
                Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setDeleteProductId(product.id)} className="text-red-600">
                <Trash className="mr-2 h-4 w-4" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: products || [],
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
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
          />
          <Select
            value={table.getColumn("status")?.getFilterValue() as string}
            onValueChange={(value) => {
              table.getColumn("status")?.setFilterValue(value)
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              setPageSize(Number(value))
              setPage(1)
            }}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue placeholder="Page size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <TableRow key={index}>
                  {Array.from({ length: columns.length }).map((_, cellIndex) => (
                    <TableCell key={cellIndex}>
                      <Skeleton className="h-6 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
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
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Showing {(page - 1) * pageSize + 1} to{" "}
          {Math.min(page * pageSize, (products?.length || 0) + (page - 1) * pageSize)} of many entries
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline" size="sm" onClick={() => setPage(page - 1)} disabled={page === 1 || isLoading}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(page + 1)}
            disabled={page === totalPages || isLoading}
          >
            Next
          </Button>
        </div>
      </div>

      <AlertDialog open={!!deleteProductId} onOpenChange={(open) => !open && setDeleteProductId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the product.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteProduct} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}