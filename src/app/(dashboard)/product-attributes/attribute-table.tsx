// src/app/(dashboard)/product-attributes/attribute-table.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import {
  Plus, MoreVertical, Search, Edit, Trash2,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead,
  TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
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

  const { hasPermission: canView, isLoading: permLoading } =
    useHasPermission(organizationId, { productAttributes: ["view"] });
  const { hasPermission: canCreate } = useHasPermission(
    organizationId, { productAttributes: ["create"] }
  );
  const { hasPermission: canUpdate } = useHasPermission(
    organizationId, { productAttributes: ["update"] }
  );
  const { hasPermission: canDelete } = useHasPermission(
    organizationId, { productAttributes: ["delete"] }
  );

  const [attributes, setAttributes]  = useState<Attribute[]>([]);
  const [loading, setLoading]        = useState(true);
  const [drawerOpen, setDrawerOpen]  = useState(false);
  const [editingAttr, setEditingAttr]= useState<Attribute | null>(null);
  const [searchQuery, setSearchQuery]= useState("");

  // bulk-delete state
  const [rowSelection, setRowSelection]   = useState<Record<string,boolean>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen]= useState(false);

  const fetchAttributes = async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permLoading, canView]);

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
      .filter(([_,v]) => v)
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

  const openEdit    = (attr: Attribute) => { setEditingAttr(attr); setDrawerOpen(true); };
  const openCreate  = () => { setEditingAttr(null); setDrawerOpen(true); };
  const closeDrawer = (refresh = false) => {
    setDrawerOpen(false); setEditingAttr(null);
    if (refresh) fetchAttributes();
  };

  if (permLoading || !canView) return null;

  const filtered = attributes.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    a.slug.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const allSelected = filtered.length > 0 && selectedCount === filtered.length;
  const someSelected = selectedCount > 0 && selectedCount < filtered.length;

  return (
    <div className="space-y-4">
      {/* Search + Add + Bulk Delete */}
      <div className="flex justify-between gap-4">
        <form onSubmit={e => e.preventDefault()} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search attributes..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

        <div className="flex items-center gap-2">
          {canCreate && (
            <Button onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> Add Attribute
            </Button>
          )}
          {canDelete && selectedCount > 0 && (
            <Button variant="destructive" onClick={() => setBulkDeleteOpen(true)}>
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
                  onCheckedChange={v => {
                    if (v) {
                      const sel: Record<string,boolean> = {};
                      filtered.forEach(a => sel[a.id] = true);
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
            ) : filtered.map(attr => {
              const isChecked = !!rowSelection[attr.id];
              return (
                <TableRow key={attr.id}>
                  <TableCell className="text-center">
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={v =>
                        setRowSelection(sel => ({ ...sel, [attr.id]: !!v }))
                      }
                    />
                  </TableCell>
                  <TableCell
                    className="font-medium cursor-pointer"
                    onClick={() => router.push(`/product-attributes/${attr.id}/terms`)}
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
            })}
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
                This will permanently delete {selectedCount} attribute(s). This action cannot be undone.
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
