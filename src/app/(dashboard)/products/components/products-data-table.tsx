/* /src/app/(dashboard)/products/components/products-data-table.tsx
   (unchanged file header kept for clarity) */
   "use client";

   import { useEffect, useState, useMemo } from "react";
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
     /*  1) Hooks                                                  */
     /* ---------------------------------------------------------- */
   
     const router = useRouter();
     const { data: activeOrg } = authClient.useActiveOrganization();
     const orgId = activeOrg?.id ?? null;
   
     const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
       orgId,
       { product: ["view"] }
     );
     const { hasPermission: canCreate, isLoading: createLoading } =
       useHasPermission(orgId, { product: ["create"] });
     const { hasPermission: canUpdate, isLoading: updateLoading } =
       useHasPermission(orgId, { product: ["update"] });
     const { hasPermission: canDelete, isLoading: deleteLoading } =
       useHasPermission(orgId, { product: ["delete"] });
   
     const [sorting, setSorting] = useState<SortingState>([]);
     const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
     const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
     const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

     const [pageSize, setPageSize] = useState(10);
     const [page, setPage] = useState(1);
     const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
     const [search, setSearch] = useState("");
     const [deleteProductId, setDeleteProductId] = useState<string | null>(null);
     const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
     const [categoryOptions, setCategoryOptions] = useState<{id:string;name:string}[]>([]);
     const [attributeOptions, setAttributeOptions] = useState<{id:string;name:string}[]>([]);
   
     const { products, isLoading, totalPages, mutate } = useProducts({
       page,
       pageSize,
       search,
     });
   
     /* ---------------------------------------------------------- */
     /*  2) Load category names                                    */
     /* ---------------------------------------------------------- */
     useEffect(() => {
       fetch("/api/product-categories?page=1&pageSize=1000", {
         headers: {
           "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
         },
       })
         .then((res) => res.json())
         .then(({ categories }) => {
           const map: Record<string, string> = {};
           categories.forEach((c: { id: string; name: string }) => {
             map[c.id] = c.name;
           });
           setCategoryMap(map);
           setCategoryOptions(categories);
         })
         .catch(() => {});
              // NEW: load all attributes for the filter UI
     fetch("/api/product-attributes?page=1&pageSize=1000", {
       headers: {
         "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
       },
     })
       .then((res) => res.json())
       .then(({ attributes }) => {
         // attributes come back as {id,name,...}
         setAttributeOptions(attributes);
       })
       .catch(() => {});
     }, []);

     /* ----------------------------------------------------------
   4a) Bulk‐delete handler
---------------------------------------------------------- */
const handleBulkDelete = async () => {
  const selectedIds = Object.keys(rowSelection).filter((id) => rowSelection[id]);
  if (!selectedIds.length) return;
  try {
    await Promise.all(
      selectedIds.map((id) =>
        fetch(`/api/products/${id}`, { method: "DELETE" })
      )
    );
    toast.success(`Deleted ${selectedIds.length} product(s)`);
    setRowSelection({});
    mutate();
  } catch {
    toast.error("Failed to delete selected products");
  } finally {
    setBulkDeleteOpen(false);
  }
};
   
     /* ---------------------------------------------------------- */
     /*  3) Table column defs                                      */
     /* ---------------------------------------------------------- */
     const columns: ColumnDef<Product>[] = [
      {
        id: "select",
        header: ({ table }) => {
          const all = table.getIsAllRowsSelected();
          const some = table.getIsSomeRowsSelected();
          return (
            <Checkbox
              checked={all}
              onCheckedChange={table.getToggleAllRowsSelectedHandler()}
              // communicate the “mixed” state via aria-checked
              aria-checked={some ? "mixed" : all}
            />
          );
        },
        cell: ({ row }) => {
          const sel = row.getIsSelected();
          const some = row.getIsSomeSelected();
          return (
            <Checkbox
              checked={sel}
              onCheckedChange={row.getToggleSelectedHandler()}
              aria-checked={some ? "mixed" : sel}
            />
          );
        },
        enableSorting: false,
      },
       {
         accessorKey: "image",
           
         header: "Image",
         cell: ({ row }) => {
           const image = row.original.image;
           const title = row.original.title;
           const initials = title
             .split(" ")
             .slice(0, 2)
             .map((word) => word.charAt(0).toUpperCase())
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
         header: "Product Title",
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
         cell: ({ row }) => {
           const status = row.original.status;
           return (
             <Select
               value={status}
               onValueChange={(value) =>
                 handleStatusChange(
                   row.original.id,
                   value as "published" | "draft"
                 )
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
           );
         },
         /* ---------- FIX: treat 'all' or undefined as no filter -- */
         filterFn: (row, _id, value) =>
           value === undefined || value === "all"
             ? true
             : row.original.status === value,
       },
           /* ────────────── Price (sortable) ────────────── */
           {
             /* numeric accessor so sorting is correct */
             accessorKey: "price",
             accessorFn: (product) => {
               const country  = Object.keys(product.regularPrice)[0] || "US";
               if (product.productType === "simple") {
                 const sale   = product.salePrice?.[country] ?? null;
                 return sale ?? product.regularPrice[country] ?? 0;
               }
               /* variable → use highest variation price */
               const prices = product.variations.map((v) => {
                 const sale = v.prices[country]?.sale ?? null;
                 const reg  = v.prices[country]?.regular ?? 0;
                 return sale ?? reg;
               });
               return prices.length ? Math.max(...prices) : 0;
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
           const product = row.original;
           const country = Object.keys(product.regularPrice)[0] || "US";
   
           if (product.productType === "simple") {
             const salePrice = product.salePrice?.[country] ?? null;
             const regularPrice = product.regularPrice[country] ?? 0;
             const displayPrice = salePrice !== null ? salePrice : regularPrice;
             return (
               <div className="text-left">
                 {displayPrice ? `$${displayPrice.toFixed(2)}` : "-"}
                 {salePrice !== null && (
                   <span className="ml-2 text-sm text-gray-500 line-through">
                     ${regularPrice.toFixed(2)}
                   </span>
                 )}
               </div>
             );
           }
   
           /* variable */
           const variationPrices = product.variations.map((v) => {
             const salePrice = v.prices[country]?.sale ?? null;
             const regularPrice = v.prices[country]?.regular ?? 0;
             return salePrice !== null ? salePrice : regularPrice;
           });
           const maxPrice = variationPrices.length
             ? Math.max(...variationPrices)
             : 0;
           return (
             <div className="text-left">
               {maxPrice ? `$${maxPrice.toFixed(2)}` : "-"}
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
           const cats = row.original.categories;
           const names = cats.map((id) => categoryMap[id] ?? id);
           return (
             <div className="flex flex-wrap gap-1">
               {names.length > 0 ? (
                 names.slice(0, 2).map((name, i) => (
                   <Badge key={i} variant="secondary" className="text-xs">
                     {name}
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
         filterFn: (row, _id, value) => row.original.categories.includes(value),
       },
        /* ────────────── Attribute Filtered Column ────────────── */
 {
   accessorKey: "attributes",
   header: "Attributes",
   cell: ({ row }) => {
     const attrs = row.original.attributes;
     return attrs.length > 0 ? (
       <div className="flex flex-wrap gap-1">
         {attrs.map((a) => (
           <Badge key={a.id} variant="secondary" className="text-xs">
             {a.name}
           </Badge>
         ))}
       </div>
     ) : (
       <span className="text-xs text-muted-foreground">—</span>
     );
   },
   // only show rows whose attributes array contains the selected id
   filterFn: (row, _id, value) =>
     row.original.attributes.some((a) => a.id === value),
 },
           /* ────────────── Created At (sortable) ────────────── */
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
                 {canUpdate && (
                   <DropdownMenuItem
                     onClick={() => router.push(`/products/${product.id}/edit`)}
                   >
                     <Edit className="mr-2 h-4 w-4" />
                     Edit
                   </DropdownMenuItem>
                 )}
                 {canUpdate && (
                   <DropdownMenuItem
                     onClick={() => handleDuplicateProduct(product.id)}
                   >
                     <Copy className="mr-2 h-4 w-4" />
                     Duplicate
                   </DropdownMenuItem>
                 )}
   
                 {canDelete && <DropdownMenuSeparator />}
                 {canDelete && (
                   <DropdownMenuItem
                     onClick={() => setDeleteProductId(product.id)}
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
     ];
   
     /* ---------------------------------------------------------- */
     /*  4) Table instance                                         */
     /* ---------------------------------------------------------- */
     const table = useReactTable({
        enableRowSelection: true,
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
     });
   
     /* ---------------------------------------------------------- */
     /*  5) Permission gates                                       */
     /* ---------------------------------------------------------- */
     if (viewLoading || createLoading || updateLoading || deleteLoading) {
       return null;
     }
   
     if (!canView) {
       router.replace("/dashboard");
       return null;
     }
   
     /* ---------------------------------------------------------- */
     /*  6) Helpers                                                */
     /* ---------------------------------------------------------- */
     const handleDuplicateProduct = async (productId: string) => {
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
     };
   
     const handleStatusChange = async (
       productId: string,
       newStatus: "published" | "draft"
     ) => {
       try {
         const response = await fetch(`/api/products/${productId}`, {
           method: "PATCH",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({ status: newStatus }),
         });
         if (!response.ok) throw new Error("Failed to update product status");
         toast.success(`Product status changed to ${newStatus}`);
         mutate();
       } catch {
         toast.error("Failed to update product status");
       }
     };
   
     const handleDeleteProduct = async () => {
       if (!deleteProductId) return;
       try {
         const response = await fetch(`/api/products/${deleteProductId}`, {
           method: "DELETE",
         });
         if (!response.ok) throw new Error("Failed to delete product");
         toast.success("The product has been deleted successfully");
         mutate();
         setDeleteProductId(null);
       } catch {
         toast.error("Failed to delete product");
       }
     };
   
     /* ---------------------------------------------------------- */
     /*  7) Render                                                 */
     /* ---------------------------------------------------------- */
     return (
       <div className="space-y-4">
         {/* Toolbar */}
         {/* mobile ⇨ stack & wrap │ ≥sm ⇨ old inline layout */}
         <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
         <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
             <Input
               placeholder="Search products..."
               value={search}
               onChange={(e) => setSearch(e.target.value)}
               className="w-full sm:max-w-sm"
             />
   
             {/* ----------- FIX: clear filter when selecting 'all' -- */}
             <Select
               value={
                 (table.getColumn("status")?.getFilterValue() as string) ?? "all"
               }
               onValueChange={(value) => {
                 const col = table.getColumn("status");
                 if (!col) return;
                 if (value === "all") {
                   col.setFilterValue(undefined); // remove filter
                 } else {
                   col.setFilterValue(value);
                 }
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
             {/* ────────── New: Category Filter ────────── */}
     <Select
       value={
         (table.getColumn("categories")?.getFilterValue() as string) ??
         "all"
       }
       onValueChange={(value) => {
         const col = table.getColumn("categories");
         if (!col) return;
         if (value === "all") col.setFilterValue(undefined);
         else col.setFilterValue(value);
         // also reset page
         setPage(1);
       }}
     >
      {/* ─── bulk delete ─── */}
        {canDelete && Object.values(rowSelection).some(Boolean) && (
          <Button
            variant="destructive"
            onClick={() => setBulkDeleteOpen(true)}
            className="ml-2"
          >
            Delete Selected ({Object.values(rowSelection).filter(Boolean).length})
          </Button>
        )}
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

     {/* ────────── New: Attribute Filter ────────── */}
     <Select
       value={
         (table.getColumn("attributes")?.getFilterValue() as string) ??
         "all"
       }
       onValueChange={(value) => {
         const col = table.getColumn("attributes");
         if (!col) return;
         if (value === "all") col.setFilterValue(undefined);
         else col.setFilterValue(value);
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
           </div>

                
         {/* PAGE-SIZE selector stays right on desktop, drops below on mobile */}
           <div className="flex items-center gap-2">
             <Select
               value={pageSize.toString()}
               onValueChange={(value) => {
                 setPageSize(Number(value));
                 setPage(1);
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
         </div>

             {/* ───── bulk delete confirmation ───── */}
    <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete selected products?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete {Object.values(rowSelection).filter(Boolean).length}{" "}
            product(s). This action cannot be undone.
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
               {table.getHeaderGroups().map((headerGroup) => (
                 <TableRow key={headerGroup.id}>
                   {headerGroup.headers.map((header) => (
                     <TableHead key={header.id}>
                       {header.isPlaceholder
                         ? null
                         : flexRender(
                             header.column.columnDef.header,
                             header.getContext()
                           )}
                     </TableHead>
                   ))}
                 </TableRow>
               ))}
             </TableHeader>
             <TableBody>
               {isLoading ? (
                 Array.from({ length: 5 }).map((_, index) => (
                   <TableRow key={index}>
                     {Array.from({ length: columns.length }).map(
                       (_, cellIndex) => (
                         <TableCell key={cellIndex}>
                           <Skeleton className="h-6 w-full" />
                         </TableCell>
                       )
                     )}
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
               (products?.length || 0) + (page - 1) * pageSize
             )}{" "}
             of many entries
           </div>
           <div className="flex items-center space-x-2">
             <Button
               variant="outline"
               size="sm"
               onClick={() => setPage(page - 1)}
               disabled={page === 1 || isLoading}
             >
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
   
         {/* Delete dialog */}
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
   