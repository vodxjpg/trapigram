// File: src/app/(dashboard)/product-attributes/[attributeId]/terms/term-table.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
  useRef,
  DragEvent,
} from "react";
import {
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
  Upload,
  Download,
  X,
} from "lucide-react";
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
import { useDebounce } from "@/hooks/use-debounce";
import { TermDrawer } from "./term-drawer";

type Term = { id: string; name: string; slug: string };

export function TermTable({ attributeId }: { attributeId: string }) {
  /* ─── Core State ───────────────────────────────────────── */
  const [terms, setTerms] = useState<Term[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  /* ─── Search & Selection ───────────────────────────────── */
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300);
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /* ─── Import/Export State ──────────────────────────────── */
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  /* ─── Fetch Terms ──────────────────────────────────────── */
  const fetchTerms = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms?pageSize=100`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch terms");
      const data = await res.json();
      setTerms(data.terms);
    } catch (err: any) {
      console.error(err);
      toast.error("Failed to load terms");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTerms();
  }, [attributeId]);

  /* ─── CRUD Helpers ─────────────────────────────────────── */
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this term?")) return;
    try {
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms/${id}`,
        { method: "DELETE", credentials: "include" }
      );
      if (!res.ok) throw new Error();
      toast.success("Term deleted");
      fetchTerms();
    } catch {
      toast.error("Failed to delete term");
    }
  };

  const handleBulkDelete = async () => {
    const ids = Object.entries(rowSelection)
      .filter(([_, v]) => v)
      .map(([k]) => k);
    if (!ids.length) return;
    try {
      const res = await fetch(`/api/product-attributes/${attributeId}/terms`, {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      toast.success(`Deleted ${data.deletedCount} term(s)`);
      setRowSelection({});
      fetchTerms();
    } catch {
      toast.error("Failed to delete selected terms");
    } finally {
      setBulkDeleteOpen(false);
    }
  };

  /* ─── Drawer Helpers ───────────────────────────────────── */
  const handleEdit = (t: Term) => {
    setEditingTerm(t);
    setDrawerOpen(true);
  };
  const handleAdd = () => {
    setEditingTerm(null);
    setDrawerOpen(true);
  };
  const handleDrawerClose = (refresh = false) => {
    setDrawerOpen(false);
    setEditingTerm(null);
    if (refresh) fetchTerms();
  };

  /* ─── Filtering & Selection ────────────────────────────── */
  const filtered = terms.filter(
    (t) =>
      t.name.toLowerCase().includes(debounced.toLowerCase()) ||
      t.slug.toLowerCase().includes(debounced.toLowerCase())
  );
  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;
  const someSelected = selectedCount > 0 && selectedCount < filtered.length;

  /* ─── Export Handler ───────────────────────────────────── */
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms/export`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ terms: filtered }),
        }
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "terms.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsExporting(false);
    }
  };

  /* ─── Import Handlers ───────────────────────────────────── */
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
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms/import`,
        { method: "POST", body: formData }
      );
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
          `✅ ${data.successCount} term(s) created\n✅ ${data.editCount} updated`
        );
        fetchTerms();
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

  /* ─── Render ───────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      {/* Hidden file input */}
      <Input
        ref={fileInputRef}
        id="file-upload"
        type="file"
        accept=".xlsx"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md relative">
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
              onClick={closeImportModal}
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-semibold mb-4">Import Terms</h2>
            <p className="text-left">
              <a
                className="text-blue-600"
                href={`/product-attributes/${attributeId}/terms-import-template.xlsx`}
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

      {/* Toolbar */}
      <div className="flex justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search terms…"
            className="pl-8 w-full"
            value={searchQuery}
            onChange={(e) =>
              startTransition(() => setSearchQuery(e.target.value))
            }
          />
        </div>
        <div className="flex items-center gap-2">
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
          <Button onClick={handleAdd} disabled={isImporting || isExporting}>
            <Plus className="mr-2 h-4 w-4" /> Add Term
          </Button>
        </div>
      </div>

      {/* Bulk-delete button */}
      {selectedCount > 0 && (
        <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" />
          Delete Selected ({selectedCount})
        </Button>
      )}

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
                    const sel: Record<string, boolean> = {};
                    if (v)
                      filtered.forEach((t) => {
                        sel[t.id] = true;
                      });
                    setRowSelection(sel);
                  }}
                />
              </TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  Loading...
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center">
                  No terms found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((term) => {
                const isChecked = !!rowSelection[term.id];
                return (
                  <TableRow key={term.id}>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(v) =>
                          setRowSelection((s) => ({
                            ...s,
                            [term.id]: !!v,
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell className="font-medium">{term.name}</TableCell>
                    <TableCell>{term.slug}</TableCell>
                    <TableCell className="text-right">
                      <MoreVertical
                        className="h-4 w-4 cursor-pointer"
                        onClick={() => handleEdit(term)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Bulk-delete dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete selected terms?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete {selectedCount} term
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

      {/* Drawer */}
      <TermDrawer
        open={drawerOpen}
        onClose={handleDrawerClose}
        term={editingTerm}
        attributeId={attributeId}
      />
    </div>
  );
}
