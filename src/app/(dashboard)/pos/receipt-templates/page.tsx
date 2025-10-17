"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { MoreHorizontal, Pencil, Plus, Trash2, Search, Eye } from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectTrigger, SelectContent, SelectItem, SelectValue,
} from "@/components/ui/select";

type TemplateRow = {
  id: string;
  name: string;
  printFormat: "thermal" | "a4";
  usageCount?: number;
  createdAt: string;
  updatedAt: string;
};

type FormatFilter = "all" | "thermal" | "a4";
export default function ReceiptTemplatesListPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = React.useState(true);
  const [rows, setRows] = React.useState<TemplateRow[]>([]);
  const [query, setQuery] = React.useState("");
  const [formatFilter, setFormatFilter] = React.useState<FormatFilter>("all");

  // add/edit dialog
  const [editOpen, setEditOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<TemplateRow | null>(null);
  const [formName, setFormName] = React.useState("");
  const [formFormat, setFormFormat] = React.useState<"thermal" | "a4">("thermal");
  const [saving, setSaving] = React.useState(false);

  // delete
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [deleteIds, setDeleteIds] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("includeUsage", "true");
      if (formatFilter !== "all") params.set("printFormat", formatFilter);
      if (query.trim()) params.set("q", query.trim());
      const res = await fetch(`/api/pos/receipt-templates?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load templates");
      const j = await res.json();
      setRows(j.templates || []);
    } catch (e: any) {
      toast.error(e?.message || "Could not load templates");
    } finally {
      setIsLoading(false);
    }
  }, [formatFilter, query]);

  React.useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setFormName("");
    setFormFormat("thermal");
    setEditOpen(true);
  }
  function openEdit(t: TemplateRow) {
    setEditing(t);
    setFormName(t.name);
    setFormFormat(t.printFormat);
    setEditOpen(true);
  }
  async function saveTemplate() {
    setSaving(true);
    try {
      if (!formName.trim()) throw new Error("Name is required.");
      if (editing) {
        const res = await fetch(`/api/pos/receipt-templates/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: formName.trim(), printFormat: formFormat }),
        });
        if (!res.ok) throw new Error("Failed to update template");
        toast.success("Template updated");
      } else {
        const res = await fetch(`/api/pos/receipt-templates`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
          },
          body: JSON.stringify({
            name: formName.trim(),
            type: "receipt",
            printFormat: formFormat,
            options: {},
          }),
        });
        if (!res.ok) throw new Error("Failed to create template");
        toast.success("Template created");
      }
      setEditOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteNow(ids: string[]) {
    await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`/api/pos/receipt-templates/${id}`, { method: "DELETE" });
        if (!r.ok) throw new Error("Delete failed");
      })
    );
  }
  async function confirmBulkDelete() {
    const ids =
      deleteIds.length > 0
        ? deleteIds
        : table.getSelectedRowModel().rows.map((r) => r.original.id);
    if (!ids.length) {
      setConfirmOpen(false);
      return;
    }
    try {
      await deleteNow(ids);
      toast.success(ids.length > 1 ? "Templates deleted" : "Template deleted");
      setConfirmOpen(false);
      setDeleteIds([]);
      await load();
    } catch {
      toast.error("Failed to delete");
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((t) => {
       const matchQ = !q || t.name.toLowerCase().includes(q);
       const matchFmt = formatFilter === "all" || t.printFormat === formatFilter;
       return matchQ && matchFmt;
     });
  }, [rows, query, formatFilter]);

  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    {
      id: "select",
      size: 30,
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllRowsSelected()}
          onCheckedChange={(v) => table.toggleAllRowsSelected(!!v)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          aria-label="Select row"
        />
      ),
    },
    {
      accessorKey: "name",
      header: "Template",
      cell: ({ row }) => {
        const t = row.original;
        return (
          <Link href={`/pos/receipt-templates/${t.id}`} className="font-medium text-primary hover:underline">
            {t.name}
          </Link>
        );
      },
    },
    {
      accessorKey: "printFormat",
      header: "Format",
      size: 120,
      cell: ({ row }) => (
        <span className="text-muted-foreground uppercase">{row.original.printFormat}</span>
      ),
    },
    {
      accessorKey: "usageCount",
      header: "Used by stores",
      size: 140,
      cell: ({ row }) => <span className="text-muted-foreground">{row.original.usageCount ?? 0}</span>,
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      size: 110,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {new Date(row.original.createdAt).toLocaleDateString()}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      size: 40,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2" onClick={() => router.push(`/pos/receipt-templates/${t.id}`)}>
                <Eye className="h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2" onClick={() => openEdit(t)}>
                <Pencil className="h-4 w-4" /> Change template's name
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2 text-destructive focus:text-destructive"
                onClick={() => {
                  setDeleteIds([t.id]);
                  setConfirmOpen(true);
                }}
              >
                <Trash2 className="h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ], [router]);

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    enableRowSelection: true,
  });

  const selectedCount = table.getSelectedRowModel().rows.length;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Receipt templates</h1>
          <p className="text-muted-foreground">Manage POS receipt templates</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button
              variant="destructive"
              className="gap-2"
              onClick={() => {
                setDeleteIds(table.getSelectedRowModel().rows.map((r) => r.original.id));
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete selected ({selectedCount})
            </Button>
          )}
          <Button className="gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" />
            Add Template
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            className="pl-9"
          />
        </div>
        <Select value={formatFilter} onValueChange={(v: FormatFilter) => setFormatFilter(v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All formats" />
          </SelectTrigger>
          <SelectContent>
           <SelectItem value="all">All formats</SelectItem>
            <SelectItem value="thermal">Thermal</SelectItem>
            <SelectItem value="a4">A4</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Apply</Button>
      </div>

      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={isLoading}
        emptyMessage="No receipt templates yet."
      />

      {/* Add/Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit template" : "Add template"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Default Template"
              />
            </div>
            <div className="space-y-2">
              <Label>Print format *</Label>
              <Select value={formFormat} onValueChange={(v: "thermal" | "a4") => setFormFormat(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="thermal">Thermal (POS)</SelectItem>
                  <SelectItem value="a4">A4</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={saveTemplate} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete {deleteIds.length > 1 ? `${deleteIds.length} templates` : "template"}?
            </AlertDialogTitle>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">
            This permanently removes the template{deleteIds.length > 1 ? "s" : ""}.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmBulkDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
