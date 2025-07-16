// File: src/app/(dashboard)/product-attributes/attribute-table.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
  useRef,
  DragEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  MoreVertical,
  Search,
  Edit,
  Trash2,
  Upload,
  Download,
  X,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useDebounce } from "@/hooks/use-debounce";

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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
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
import { toast } from "sonner";

import { AttributeDrawer } from "./attribute-drawer";

type Attribute = {
  id: string;
  name: string;
  slug: string;
  _count?: { terms: number };
};

export function AttributeTable() {
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canView, isLoading: permLoading } = useHasPermission(
    organizationId,
    { productAttributes: ["view"] }
  );
  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    productAttributes: ["create"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    productAttributes: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    productAttributes: ["delete"],
  });

  // Core state
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingAttr, setEditingAttr] = useState<Attribute | null>(null);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300);

  // Bulk-delete
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  // Import/export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  // Fetch attributes
  const fetchAttributes = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/product-attributes?pageSize=100`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch attributes");
      const data = await res.json();
      setAttributes(data.attributes);
    } catch (err: any) {
      toast.error(err.message || "Failed to load attributes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (permLoading) return;
    if (!canView) {
      router.replace("/dashboard");
      return;
    }
    fetchAttributes();
  }, [permLoading, canView]);

  // CRUD handlers
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this attribute (and all its terms)?")) return;
    try {
      const res = await fetch(`/api/product-attributes/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Attribute deleted");
      fetchAttributes();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete attribute");
    }
  };

  const handleBulkDelete = async () => {
    const ids = Object.entries(rowSelection)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    if (!ids.length) return;
    try {
      const res = await fetch("/api/product-attributes", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("Bulk delete failed");
      const data = await res.json();
      toast.success(`Deleted ${data.deletedCount} attributes`);
      setRowSelection({});
      fetchAttributes();
    } catch {
      toast.error("Failed to delete selected attributes");
    } finally {
      setBulkDeleteOpen(false);
    }
  };

  // Drawer handlers
  const openEdit = (attr: Attribute) => {
    setEditingAttr(attr);
    setDrawerOpen(true);
  };
  const openCreate = () => {
    setEditingAttr(null);
    setDrawerOpen(true);
  };
  const closeDrawer = (refresh = false) => {
    setDrawerOpen(false);
    setEditingAttr(null);
    if (refresh) fetchAttributes();
  };

  // Filtered view
  const filtered = attributes.filter(
    (a) =>
      a.name.toLowerCase().includes(debounced.toLowerCase()) ||
      a.slug.toLowerCase().includes(debounced.toLowerCase())
  );

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;
  const someSelected = selectedCount > 0 && selectedCount < filtered.length;

  if (permLoading || !canView) return null;

  // Export handler
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/product-attributes/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attributes: filtered }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "attributes.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  // Import handlers
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
      const res = await fetch("/api/product-attributes/import", {
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
          `✅ ${data.successCount} attribute(s) created\n✅ ${data.editCount} updated`
        );
        fetchAttributes();
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
  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };
  const handleDragOver = (e: DragEvent) => e.preventDefault();

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
            <h2 className="text-xl font-semibold mb-4">Import Attributes</h2>
            <p className="text-left">
              <a
                className="text-blue-600"
                href="/product-attributes-import-template.xlsx"
                target="_blank"
              >
                Download a template
              </a>{" "}
              to see the import format
            </p>
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              className="flex flex-col items-center justify-center border-2 border- dashed border-gray-300 rounded-lg p-6 cursor-pointer hover:border-gray-400 transition"
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

      {/* Search / Import / Export / Add / Bulk delete */}
      <div className="flex justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search attributes…"
            className="pl-8 w-full"
            value={searchQuery}
            onChange={(e) => {
              const txt = e.target.value;
              startTransition(() => setSearchQuery(txt));
            }}
          />
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
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
                Export
              </Button>
              <Button
                onClick={openCreate}
                disabled={isImporting || isExporting}
              >
                <Plus className="mr-2 h-4 w-4" /> Add Attribute
              </Button>
            </>
          )}
          {canDelete && selectedCount > 0 && (
            <Button
              variant="destructive"
              onClick={() => setBulkDeleteOpen(true)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete Selected ({selectedCount})
            </Button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px] text-center">
                <Checkbox
                  checked={allSelected}
                  aria-checked={someSelected ? "mixed" : allSelected}
                  onCheckedChange={(v) => {
                    if (v) {
                      const sel: Record<string, boolean> = {};
                      filtered.forEach((a) => (sel[a.id] = true));
                      setRowSelection(sel);
                    } else {
                      setRowSelection({});
                    }
                  }}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Terms</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center">
                  No attributes found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((attr) => {
                const isChecked = !!rowSelection[attr.id];
                return (
                  <TableRow key={attr.id}>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          setRowSelection((sel) => ({
                            ...sel,
                            [attr.id]: !!v,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell
                      className="font-medium cursor-pointer"
                      onClick={() =>
                        router.push(`/product-attributes/${attr.id}/terms`)
                      }
                    >
                      {attr.name}
                    </TableCell>
                    <TableCell>{attr.slug}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{attr._count?.terms ?? 0}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {canUpdate && (
                            <DropdownMenuItem onClick={() => openEdit(attr)}>
                              <Edit className="mr-2 h-4 w-4" /> Edit
                            </DropdownMenuItem>
                          )}
                          {canDelete && canUpdate && <DropdownMenuSeparator />}
                          {canDelete && (
                            <DropdownMenuItem
                              onClick={() => handleDelete(attr.id)}
                              className="text-destructive"
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

      {/* Bulk-delete confirmation */}
      {canDelete && (
        <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete selected attributes?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete {selectedCount} attribute
                {selectedCount === 1 ? "" : "s"}. This action cannot be undone.
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

      {/* Drawer */}
      <AttributeDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        attribute={editingAttr}
      />
    </div>
  );
}
