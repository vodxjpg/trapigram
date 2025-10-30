// Component: SuppliersView (updated to place "New Supplier" on the search row)
"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Search, Plus, ArrowLeft, Save, Pencil, Trash2, MoreVertical } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import {
  useReactTable,
  getCoreRowModel,
  type ColumnDef,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

interface Supplier {
  id: string;
  code: string;
  name: string;
  email: string;
  phone?: string | null;
}

type SuppliersResponse = Supplier[] | { suppliers: Supplier[] };

export function SuppliersView() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const isEditing = !!editingId;

  const [formData, setFormData] = useState({
    code: "",
    name: "",
    email: "",
    phone: "",
  });

  const itemsPerPage = 10;

  const openCreate = () => {
    setEditingId(null);
    setFormData({ code: "", name: "", email: "", phone: "" });
    setIsSheetOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingId(s.id);
    setFormData({
      code: s.code ?? "",
      name: s.name ?? "",
      email: s.email ?? "",
      phone: s.phone ?? "",
    });
    setIsSheetOpen(true);
  };

  const deleteSupplier = async (id: string) => {
    try {
      const res = await fetch(`/api/suppliers/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error || "Failed to delete supplier");
      }
      setSuppliers((prev) => prev.filter((s) => s.id !== id));
      toast.success("Supplier deleted");
    } catch (err: any) {
      toast.error(err?.message || "Could not delete supplier.");
    }
  };

  // Load suppliers
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/suppliers", { cache: "no-store" });
        if (!res.ok) {
          const msg =
            (await res.text()) || `Failed to fetch suppliers (${res.status})`;
          throw new Error(msg);
        }
        const data: SuppliersResponse = await res.json();
        const list = Array.isArray(data) ? data : data.suppliers;
        setSuppliers(Array.isArray(list) ? list : []);
      } catch (e: any) {
        setError(e?.message || "Error loading suppliers");
        toast.error(e?.message || "Error loading suppliers");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Filter + paginate
  const filteredSuppliers = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter((s) => {
      return (
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        (s.phone?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [suppliers, searchTerm]);

  const totalPages = Math.ceil(filteredSuppliers.length / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedSuppliers = filteredSuppliers.slice(
    startIndex,
    startIndex + itemsPerPage
  );

  // Create/Update
  const handleSave = async () => {
    const name = formData.name.trim();
    const email = formData.email.trim();
    const code = formData.code.trim();
    const phone = formData.phone.trim();

    if (!name || !email) {
      toast.error("Name and email are required.");
      return;
    }

    setSaving(true);
    try {
      if (isEditing && editingId) {
        const res = await fetch(`/api/suppliers/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code || undefined,
            name,
            email,
            phone: phone || null,
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(payload?.error || "Failed to update supplier");

        const updated: Supplier = payload.supplier;
        setSuppliers((prev) =>
          prev.map((s) => (s.id === updated.id ? updated : s))
        );
        toast.success("Supplier updated");
      } else {
        const res = await fetch("/api/suppliers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code || undefined,
            name,
            email,
            phone: phone || null,
          }),
        });

        const payload = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(payload?.error || "Failed to create supplier");

        const created: Supplier = payload.supplier;
        setSuppliers((prev) => [...prev, created]);
        toast.success("Supplier created");
      }

      setIsSheetOpen(false);
      setEditingId(null);
    } catch (err: any) {
      toast.error(err?.message || "There was a problem saving the supplier.");
    } finally {
      setSaving(false);
    }
  };

  // Columns for StandardDataTable
  const columns: ColumnDef<Supplier>[] = useMemo(
    () => [
      {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <span className="font-medium">{row.original.code}</span>,
      },
      { accessorKey: "name", header: "Name" },
      { accessorKey: "email", header: "Email" },
      {
        accessorKey: "phone",
        header: "Phone",
        cell: ({ row }) => row.original.phone || "-",
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const supplier = row.original;
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => openEdit(supplier)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </DropdownMenuItem>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <DropdownMenuItem
                        onSelect={(e) => e.preventDefault()}
                        className="text-red-600 focus:text-red-600"
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete supplier?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This action cannot be undone. The supplier “{supplier.name}” will be permanently removed.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-red-600 hover:bg-red-700"
                          onClick={() => deleteSupplier(supplier.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const table = useReactTable({
    data: paginatedSuppliers,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="space-y-4">
      {/* Header row + search + New Supplier button (moved here) */}
      <div className="space-y-2">
        <div className="flex items-center gap-4 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search suppliers..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="pl-10"
            />
          </div>

          {/* New Supplier (Sheet) aligned to the end of the same row */}
          <Sheet
            open={isSheetOpen}
            onOpenChange={(open) => {
              setIsSheetOpen(open);
              if (!open) setEditingId(null);
            }}
          >
            <SheetTrigger asChild>
              <Button onClick={openCreate} className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                New Supplier
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-[92vw] sm:w-[560px] md:w-[680px] lg:w-[760px] p-6 sm:p-8"
            >
              <SheetHeader>
                <SheetTitle>
                  {isEditing ? "Edit Supplier" : "Create New Supplier"}
                </SheetTitle>
              </SheetHeader>

              <div className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="code">Code</Label>
                  <Input
                    id="code"
                    placeholder="Leave empty for auto-generation"
                    value={formData.code}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, code: e.target.value }))
                    }
                  />
                  {!isEditing && !formData.code && (
                    <p className="text-sm text-muted-foreground">
                      Will be auto-generated
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    placeholder="Supplier name"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, name: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="supplier@example.com"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, email: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone">Phone (Optional)</Label>
                  <Input
                    id="phone"
                    placeholder="+1-555-0123"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData((prev) => ({ ...prev, phone: e.target.value }))
                    }
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    onClick={() => {
                      setIsSheetOpen(false);
                      setEditingId(null);
                    }}
                    variant="outline"
                    className="flex items-center gap-2 bg-transparent"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <Button
                    onClick={handleSave}
                    className="flex items-center gap-2 flex-1"
                    disabled={saving}
                  >
                    <Save className="h-4 w-4" />
                    {isEditing ? "Update" : "Save"}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Standardized table */}
      {loading ? (
        <StandardDataTable
          table={table}
          columns={columns}
          isLoading
          skeletonRows={itemsPerPage}
          emptyMessage="Loading suppliers…"
        />
      ) : error ? (
        <div className="py-10 text-center text-sm text-red-600">{error}</div>
      ) : (
        <>
          <StandardDataTable
            table={table}
            columns={columns}
            isLoading={false}
            skeletonRows={itemsPerPage}
            emptyMessage="No suppliers found."
          />

          {/* Pagination */}
          <div className="flex items-center justify-between space-x-2 py-4">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to{" "}
              {Math.min(startIndex + itemsPerPage, filteredSuppliers.length)} of{" "}
              {filteredSuppliers.length} suppliers
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
              >
                Previous
              </Button>
              <div className="flex items-center gap-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                  (page) => (
                    <Button
                      key={page}
                      variant={currentPage === page ? "default" : "outline"}
                      size="sm"
                      onClick={() => setCurrentPage(page)}
                      className="w-8 h-8 p-0"
                    >
                      {page}
                    </Button>
                  )
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setCurrentPage((p) => Math.min(p + 1, totalPages))
                }
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
