// File: src/app/(dashboard)/products/categories/category-tabl.tsx
"use client";

import React, { useState, useEffect, startTransition, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
  Upload,
  Download,
  X,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "@/hooks/use-debounce";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CategoryDrawer } from "./category-drawer";
import { getInitials } from "@/lib/utils";
import { toast } from "sonner";

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

export function CategoryTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canMutate, isLoading: loadMutate } = useHasPermission(
    organizationId,
    { productCategories: ["update"] }
  );
  const { hasPermission: canDelete, isLoading: loadDelete } = useHasPermission(
    organizationId,
    { productCategories: ["delete"] }
  );

  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);

  /* ── import/export states ───────────────────────────────────── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  /* ── search & pagination ───────────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300);
  const [pageSize, setPageSize] = useState(10);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);

  /* ── bulk-delete ───────────────────────────────────────────── */
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/product-categories?page=${currentPage}&pageSize=${pageSize}&search=${debounced}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch categories");
      const data = await res.json();
      const safeCats = data.categories.map((c: Category) => ({
        ...c,
        _count: { products: c._count?.products ?? 0 },
        children: c.children ?? [],
        parentName: c.parentId
          ? data.categories.find((x: Category) => x.id === c.parentId)?.name ||
            "Unknown"
          : "",
      }));
      safeCats.sort((a, b) => {
        if (!a.parentId && b.parentId) return -1;
        if (a.parentId && !b.parentId) return 1;
        if (a.parentId === b.parentId) return a.order - b.order;
        return (a.parentId || "").localeCompare(b.parentId || "");
      });
      setCategories(safeCats);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCategories();
  }, [currentPage, pageSize, debounced]);

  /* ── single-delete ──────────────────────────────────────────── */
  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/product-categories/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete category");
      toast.success("Category deleted");
      fetchCategories();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  /* ── bulk-delete handler ───────────────────────────────────── */
  const handleBulkDelete = async () => {
    const ids = Object.entries(rowSelection)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    if (!ids.length) return;
    try {
      const res = await fetch("/api/product-categories", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Bulk delete failed");
      const data = await res.json();
      toast.success(`Deleted ${data.deletedCount} categories`);
      setRowSelection({});
      fetchCategories();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBulkDeleteOpen(false);
    }
  };

  /* ── import handlers ────────────────────────────────────────── */
  const openImportModal = () => {
    setImportMessage(null);
    setImportErrors([]);
    setShowImportModal(true);
  };
  const closeImportModal = () => {
    setShowImportModal(false);
    setIsImporting(false);
    setImportMessage(null);
    setImportErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const processFile = async (file: File) => {
    setIsImporting(true);
    setImportMessage(null);
    setImportErrors([]);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/product-categories/import", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (res.status === 207 && data.errors) {
        setImportMessage(`❌ Some rows failed to import`);
        setImportErrors(
          data.errors.map((e: any) => `Row ${e.row}: ${e.error}`)
        );
      } else if (!res.ok) {
        let error = "";
        for (const err of data.rowErrors || []) {
          error += `❌ ${err.error} in row ${err.row}.\n`;
        }
        setImportMessage(error || "❌ Import failed");
      } else {
        setImportMessage(
          `✅ ${data.successCount} category(ies) created. ✅ ${data.editCount} updated.`
        );
        fetchCategories();
      }
    } catch (err: any) {
      setImportMessage(`❌ ${err.message}`);
    } finally {
      setIsImporting(false);
    }
  };
  const handleFileChange = () => {
    const file = fileInputRef.current?.files?.[0];
    if (file) processFile(file);
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleDragOver = (e: React.DragEvent) => e.preventDefault();

  /* ── export handler ────────────────────────────────────────── */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/product-categories/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "categories.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const permsLoading = loadMutate || loadDelete;
  if (permsLoading) return <div className="p-6">Loading permissions…</div>;

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const allSelected =
    categories.length > 0 && selectedCount === categories.length;
  const someSelected = selectedCount > 0 && selectedCount < categories.length;

  return (
    <div className="space-y-4">
      {/* hidden file input */}
      <Input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* import modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md relative">
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
              onClick={closeImportModal}
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-semibold mb-4">Import Categories</h2>
            <p className="text-left">
              <a
                className="text-blue-600"
                href="/product-categories-import-template.xlsx"
                target="_blank"
              >
                Download a template
              </a>{" "}
              to see the import format
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-gray-400 transition"
            >
              <Upload className="mb-2 h-6 w-6 text-gray-500" />
              <span className="font-medium">Drag &amp; Drop file here</span>
              <span className="text-sm text-gray-500 mt-1">
                or click to select
              </span>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => fileInputRef.current?.click()}
                disabled={isImporting}
              >
                Browse files
              </Button>
            </div>
            {importMessage && (
              <p
                className={`mt-4 text-center whitespace-pre-line font-medium ${
                  importMessage.startsWith("✅")
                    ? "text-green-600"
                    : "text-red-600"
                }`}
              >
                {importMessage}
              </p>
            )}
            {importErrors.length > 0 && (
              <ul className="mt-2 text-red-600 list-disc list-inside text-sm">
                {importErrors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
            {isImporting && (
              <div className="absolute inset-0 bg-white/75 flex items-center justify-center rounded-xl">
                <span>Importing...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* filters & actions */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex w-full sm:w-auto gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search categories…"
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => {
                const txt = e.target.value;
                startTransition(() => {
                  setSearchQuery(txt);
                  setCurrentPage(1);
                });
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canMutate && (
            <>
              <Button
                variant="outline"
                onClick={openImportModal}
                disabled={isImporting}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import
              </Button>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={isExporting}
              >
                <Download className="mr-2 h-4 w-4" />
                {isExporting ? "Exporting..." : "Export"}
              </Button>
              <Button
                onClick={() => {
                  setEditingCategory(null);
                  setDrawerOpen(true);
                }}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Category
              </Button>
            </>
          )}
        </div>
      </div>

      {/* bulk-delete */}
      {canDelete && selectedCount > 0 && (
        <div className="flex justify-end">
          <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
            <Trash2 className="mr-2 h-4 w-4" />
            Delete Selected ({selectedCount})
          </Button>
        </div>
      )}

      {/* table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox
                  checked={allSelected}
                  aria-checked={someSelected ? "mixed" : allSelected}
                  onCheckedChange={(v) => {
                    const newSel: Record<string, boolean> = {};
                    if (v) categories.forEach((c) => (newSel[c.id] = true));
                    setRowSelection(newSel);
                  }}
                />
              </TableHead>
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
                <TableCell colSpan={7} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : categories.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center">
                  No categories found.
                </TableCell>
              </TableRow>
            ) : (
              categories.map((cat) => {
                const isChecked = !!rowSelection[cat.id];
                return (
                  <TableRow key={cat.id}>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) => {
                          setRowSelection((sel) => ({
                            ...sel,
                            [cat.id]: !!v,
                          }));
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {cat.image ? (
                        <Image
                          src={cat.image}
                          alt={cat.name}
                          width={40}
                          height={40}
                          className="rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                          {getInitials(cat.name)}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{cat.name}</TableCell>
                    <TableCell>{cat.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {cat._count?.products ?? 0}
                      </Badge>
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
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingCategory(cat);
                                setDrawerOpen(true);
                              }}
                            >
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
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* pagination controls */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(+v);
              setCurrentPage(1);
            }}
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
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            disabled={currentPage === totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* delete dialogs */}
      {canDelete && (
        <Dialog
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete category</DialogTitle>
              <DialogDescription>
                Deleting a category will orphan sub-categories & unlink
                products. Proceed?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-end">
              <Button variant="secondary" onClick={() => setDeleteTarget(null)}>
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
      {canDelete && (
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete selected categories?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {selectedCount} category(ies). This
                action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-red-600 hover:bg-red-700"
                onClick={handleBulkDelete}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {(canMutate || canDelete) && (
        <CategoryDrawer
          open={drawerOpen}
          onClose={(refresh?: boolean) => {
            setDrawerOpen(false);
            setEditingCategory(null);
            if (refresh) fetchCategories();
          }}
          category={editingCategory}
        />
      )}
    </div>
  );
}
