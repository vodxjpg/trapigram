// src/app/(dashboard)/product-attributes/[attributeId]/terms/term-table.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
} from "react";
import {
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Edit,
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
import { useDebounce } from "@/hooks/use-debounce";     // ← NEW
import { TermDrawer } from "./term-drawer";

type Term = { id: string; name: string; slug: string };

export function TermTable({ attributeId }: { attributeId: string }) {
  /* ───────────────────── state ───────────────────── */
  const [terms,        setTerms]        = useState<Term[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [drawerOpen,   setDrawerOpen]   = useState(false);
  const [editingTerm,  setEditingTerm]  = useState<Term | null>(null);

  // search
  const [searchQuery,  setSearchQuery]  = useState("");
  const debounced                        = useDebounce(searchQuery, 300); // ← NEW

  // bulk-delete
  const [rowSelection,   setRowSelection]   = useState<Record<string, boolean>>(
    {},
  );
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /* ───────────────────── data fetch ───────────────── */
  const fetchTerms = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms?pageSize=100`,
        { credentials: "include" },
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

  /* ───────────────────── CRUD helpers ─────────────── */
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this term?")) return;
    try {
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms/${id}`,
        { method: "DELETE", credentials: "include" },
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
      const res = await fetch(
        `/api/product-attributes/${attributeId}/terms`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        },
      );
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

  /* ───────────────────── drawer helpers ───────────── */
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

  /* ───────────────────── filtering & selection ────── */
  const filtered = terms.filter(
    (t) =>
      t.name.toLowerCase().includes(debounced.toLowerCase()) ||
      t.slug.toLowerCase().includes(debounced.toLowerCase()),
  );

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const allSelected   =
    filtered.length > 0 && selectedCount === filtered.length;
  const someSelected  =
    selectedCount > 0 && selectedCount < filtered.length;

  /* ───────────────────── render ───────────────────── */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex justify-between gap-4">
        {/* live search (debounced) */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search terms…"
            className="pl-8 w-full"
            value={searchQuery}
            onChange={(e) => {
              const txt = e.target.value;
              startTransition(() => setSearchQuery(txt));
            }}
          />
        </div>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" /> Add Term
        </Button>
      </div>

      {/* Bulk delete */}
      {selectedCount > 0 && (
        <Button
          variant="destructive"
          onClick={() => setBulkDeleteOpen(true)}
        >
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
                    if (v) {
                      const sel: Record<string, boolean> = {};
                      filtered.forEach((t) => (sel[t.id] = true));
                      setRowSelection(sel);
                    } else {
                      setRowSelection({});
                    }
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
                    <TableCell className="font-medium">
                      {term.name}
                    </TableCell>
                    <TableCell>{term.slug}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => handleEdit(term)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => handleDelete(term.id)}
                            className="text-destructive"
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                          </DropdownMenuItem>
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

      {/* Bulk-delete dialog */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
      >
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
