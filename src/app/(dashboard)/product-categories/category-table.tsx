// src/app/(dashboard)/products/categories/category-table.tsx
"use client";

import type React                from "react";
import { useState, useEffect }   from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image                     from "next/image";
import {
  ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  MoreVertical, Plus, Search, Trash2, Edit,
}                                from "lucide-react";

import { authClient }            from "@/lib/auth-client";
import { useHasPermission }      from "@/hooks/use-has-permission";

import { Button }                from "@/components/ui/button";
import { Input }                 from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
}                                from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger,
}                                from "@/components/ui/dropdown-menu";
import {
    Dialog, DialogContent, DialogHeader, DialogTitle,
    DialogDescription, DialogFooter, DialogTrigger,
  }                                from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
}                                from "@/components/ui/select";
import { Badge }                 from "@/components/ui/badge";
import { CategoryDrawer }        from "./category-drawer";
import { getInitials }           from "@/lib/utils";
import { toast }                 from "sonner";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type Category = {
  id: string;
  name: string;
  slug: string;
  image: string | null;
  order: number;
  parentId: string | null;
  _count?: { products?: number };
  children?: Category[];
  parentName?: string;
};

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export function CategoryTable() {
  const router        = useRouter();
  const searchParams  = useSearchParams();

  /* ── active organisation id ───────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── permissions ──────────────────────────────────────────────── */
  const { hasPermission: canMutate,  isLoading: loadMutate  } =
    useHasPermission(organizationId, { productCategories: ["update"] });
  const { hasPermission: canDelete,  isLoading: loadDelete  } =
    useHasPermission(organizationId, { productCategories: ["delete"] });

  /* ── local state ──────────────────────────────────────────────── */
  const [categories,       setCategories      ] = useState<Category[]>([]);
  const [loading,          setLoading         ] = useState(true);
  const [totalPages,       setTotalPages      ] = useState(1);
  const [currentPage,      setCurrentPage     ] = useState(1);
  const [searchQuery,      setSearchQuery     ] = useState("");
  const [pageSize,         setPageSize        ] = useState(10);
  const [drawerOpen,       setDrawerOpen      ] = useState(false);
  const [editingCategory,  setEditingCategory ] = useState<Category | null>(null);

  /* ---------------------------------------------------------------- */
  /*  Fetch                                                           */
  /* ---------------------------------------------------------------- */
  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/product-categories?page=${currentPage}&pageSize=${pageSize}&search=${searchQuery}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to fetch categories");
      }
      const data = await res.json();

      const safeCats = data.categories.map((c: Category) => ({
        ...c,
        _count:   { products: c._count?.products ?? 0 },
        children: c.children ?? [],
        parentName: c.parentId
          ? data.categories.find((x: Category) => x.id === c.parentId)?.name || "Unknown"
          : "",
      }));

      safeCats.sort((a, b) => {
        if (!a.parentId && b.parentId) return -1;
        if (a.parentId && !b.parentId) return  1;
        if (a.parentId === b.parentId) return a.order - b.order;
        return (a.parentId?.localeCompare(b.parentId || "") ?? 0);
      });

      setCategories(safeCats);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCategories(); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentPage, pageSize, searchQuery]);

  /* ---------------------------------------------------------------- */
  /*  Handlers                                                        */
  /* ---------------------------------------------------------------- */
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    fetchCategories();
  };

    /* ---------------- Dialog-driven delete ----------------- */
    const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  
    const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/product-categories/${id}`, {
        method: "DELETE", credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to delete category");
      }
      toast.success("Category deleted");
      fetchCategories();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete category");
    }
  };

  const handleEdit = (cat: Category) => {
    setEditingCategory(cat);
    setDrawerOpen(true);
  };

  const handleAdd = () => {
    setEditingCategory(null);
    setDrawerOpen(true);
  };

  const handleDrawerClose = (refresh?: boolean) => {
    setDrawerOpen(false);
    setEditingCategory(null);
    if (refresh) fetchCategories();
  };

  /* ---------------------------------------------------------------- */
  /*  Helpers                                                         */
  /* ---------------------------------------------------------------- */
  const renderImage = (cat: Category) =>
    cat.image
      ? (
        <Image
          src={cat.image}
          alt={cat.name}
          width={40} height={40}
          className="rounded-full object-cover"
        />
      )
      : (
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
          {getInitials(cat.name)}
        </div>
      );

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */
  const permsLoading = loadMutate || loadDelete;

  if (permsLoading) {
    return <div className="p-6">Loading permissions…</div>;
  }

  return (
    <div className="space-y-4">
      {/* Filters & Add button ------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form onSubmit={handleSearch} className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search categories…"
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        {canMutate && (
          <Button onClick={handleAdd}>
            <Plus className="mr-2 h-4 w-4" />
            Add Category
          </Button>
        )}
      </div>

      {/* Table -------------------------------------------------------------- */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">Image</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Products</TableHead>
              <TableHead>Parent</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center">
                  No categories found.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((cat) => (
                <TableRow key={cat.id}>
                  <TableCell>{renderImage(cat)}</TableCell>
                  <TableCell className="font-medium">{cat.name}</TableCell>
                  <TableCell>{cat.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{cat._count?.products ?? 0}</Badge>
                  </TableCell>
                  <TableCell>{cat.parentName || "None"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canMutate && (
                          <DropdownMenuItem onClick={() => handleEdit(cat)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                        )}
                                             {canDelete && (
                       <DropdownMenuItem
                         onClick={() => setDeleteTarget(cat)}
                         className="text-destructive focus:text-destructive"
                       >
                         <Trash2 className="mr-2 h-4 w-4" /> Delete
                       </DropdownMenuItem>
                     )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination --------------------------------------------------------- */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2">
          <div className="flex-row sm:flex-col">
            <p className="text-sm font-medium">Rows per page</p>
            <Select
              value={pageSize.toString()}
              onValueChange={(v) => { setPageSize(Number(v)); setCurrentPage(1); }}
            >
              <SelectTrigger className="h-8 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent side="top">
                {[5, 10, 20, 50, 100].map((n) => (
                  <SelectItem key={n} value={n.toString()}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
              <ChevronsLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
              disabled={currentPage === 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
              disabled={currentPage === totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}>
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Drawer ------------------------------------------------------------- */}
      {(canMutate || canDelete) && (
        <CategoryDrawer
          open={drawerOpen}
          onClose={handleDrawerClose}
          category={editingCategory}
        />
      )}

    {/* ---------- Delete confirmation dialog ---------- */}
    {canDelete && (
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete category</DialogTitle>
            <DialogDescription>
              Deleting a category means sub-categories and products won’t have any
              category attached to them. You will need to adjust them manually.
              Are you sure you would like to continue?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-end">
            <Button
              variant="secondary"
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!deleteTarget) return;
                await handleDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )}
    </div>
  );
}
