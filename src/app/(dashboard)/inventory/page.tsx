"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Search,
  Plus,
  FileDown,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
import { PageHeader } from "@/components/page-header";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
type InventoryCountRow = {
  id: string | number;
  reference: string;
  warehouse: string;
  countType: string;
  startedOn: string;
  isCompleted: boolean; // ISO or human-readable
};

export default function Component() {
  const router = useRouter();
  // org  permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(orgId, { stockManagement: ["view"] });
  const { hasPermission: canUpdate, isLoading: updateLoading } = useHasPermission(orgId, { stockManagement: ["update"] });

  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/products"); // or "/" – match your UX
  }, [viewLoading, canView, router]);
  // ❌ Do not early-return before hooks
  const permsLoading = viewLoading || updateLoading;
  const canShow = !permsLoading && canView;
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // fetched data + states
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCountRow[]>(
    []
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<InventoryCountRow | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  // Fetch list from /api/inventory and normalize to table shape
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        if (!canView) return; // guard when permission denied
        const res = await fetch("/api/inventory", { method: "GET" });
        if (!res.ok) {
          throw new Error(`Failed to fetch inventories: ${res.status}`);
        }
        const data = await res.json();

        const list: any[] = Array.isArray(data)
          ? data
          : Array.isArray(data?.items)
            ? data.items
            : [];

        const rows: InventoryCountRow[] = list.map((inv: any, idx: number) => {
          const id = inv?.id ?? inv?._id ?? idx;
          const reference = inv?.reference ?? inv?.ref ?? `INV-${id}`;
          const warehouse = inv?.warehouse ?? inv?.name ?? "—";
          const countType =
            inv?.countType ?? inv?.count_type ?? inv?.type ?? "—";
          const startedRaw =
            inv?.startedOn ??
            inv?.started_at ??
            inv?.createdAt ??
            inv?.created_at ??
            null;
          const startedOn = startedRaw
            ? new Date(startedRaw).toLocaleDateString()
            : "—";
          const isCompleted = Boolean(inv?.isCompleted);
          return {
            id,
            reference,
            warehouse,
            countType,
            startedOn,
            isCompleted,
          };
        });

        if (isMounted) setInventoryCounts(rows);
      } catch (e: any) {
        if (isMounted) setError(e?.message ?? "Unknown error");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [canView]);

  // Filter data based on search term
  const filteredData = useMemo(() => {
    return inventoryCounts.filter(
      (item) =>
        item.reference.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.warehouse.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.countType.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.startedOn.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [searchTerm, inventoryCounts]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentData = filteredData.slice(startIndex, endIndex);

  // Reset to first page when search changes
  const handleSearchChange = (value: string) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleExportExcel = async (row: InventoryCountRow) => {
    try {
      if (!row.isCompleted) return; // guard
      const res = await fetch(`/api/inventory/${row.id}/export-xlsx`, {
        method: "GET",
      });
      if (!res.ok) {
        throw new Error(`Export failed: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-${row.reference}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to export file");
    }
  };

  // export to PDF via /api/inventory/[id]/export-pdf/
  const handleExportPDF = async (row: InventoryCountRow) => {
    try {
      if (!row.isCompleted) return; // guard
      const res = await fetch(`/api/inventory/${row.id}/export-pdf/`, {
        method: "GET",
      });
      if (!res.ok) {
        throw new Error(`PDF export failed: ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `inventory-${row.reference}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to export PDF");
    }
  };

  // DELETE /api/inventory/[ID] (triggered from AlertDialog)
  const handleDelete = async (row: InventoryCountRow) => {
    if (!canUpdate) return; // permission guard
    try {
      setDeleting(true);
      const res = await fetch(`/api/inventory/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(
          msg || `Failed to delete inventory ${row.id} (status ${res.status})`
        );
      }
      // remove from UI
      setInventoryCounts((prev) => prev.filter((r) => r.id !== row.id));
      setDeleteOpen(false);
      setRowToDelete(null);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete inventory");
    } finally {
      setDeleting(false);
    }
  };

  // --- helper to render status badge ---
  const renderStatusBadge = (completed: boolean) => {
    if (completed) {
      return (
        <span className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
          Completed
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-2 rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-xs font-medium text-yellow-700">
        <span className="h-2 w-2 rounded-full bg-yellow-500" aria-hidden />
        Pending
      </span>
    );
  };

  // Render gate AFTER hooks are declared
  if (permsLoading) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }
  if (!canShow) {
    return null; // redirect effect above will take over
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Inventory Counts</h1>


      </div>

      <PageHeader
        title="Inventory count"
        description="Count your inventory and get a detailed report"
        actions={
          canUpdate ? (
            <div className="flex items-center gap-2">
              <Button asChild className="flex items-center gap-2">
                <Link href="/inventory/new">
                  <Plus className="h-4 w-4" />
                  Add New Count
                </Link>
              </Button>
            </div>
          ) : null
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Inventory Count Records</CardTitle>
          <div className="flex items-center space-x-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search inventory counts..."
                value={searchTerm}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Warehouse</TableHead>
                  <TableHead>Count Type</TableHead>
                  <TableHead>Started On</TableHead>
                  <TableHead>Status</TableHead>
                  {/* NEW column */}
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : error ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-red-600"
                    >
                      {error}
                    </TableCell>
                  </TableRow>
                ) : currentData.length > 0 ? (
                  currentData.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.reference}
                      </TableCell>
                      <TableCell>{item.warehouse}</TableCell>
                      <TableCell>{item.countType}</TableCell>
                      <TableCell>{item.startedOn}</TableCell>
                      <TableCell>
                        {renderStatusBadge(item.isCompleted)}
                      </TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem asChild>
                              <Link
                                href={`/inventory/${item.id}`}
                                className="flex items-center gap-2"
                              >
                                <ExternalLink className="h-4 w-4" />
                                Open
                              </Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                item.isCompleted && handleExportExcel(item)
                              }
                              className={`flex items-center gap-2 ${!item.isCompleted
                                  ? "cursor-not-allowed opacity-60"
                                  : ""
                                }`}
                              disabled={!item.isCompleted}
                            >
                              <FileDown className="h-4 w-4" />
                              Export to Excel
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                item.isCompleted && handleExportPDF(item)
                              }
                              className={`flex items-center gap-2 ${!item.isCompleted
                                  ? "cursor-not-allowed opacity-60"
                                  : ""
                                }`}
                              disabled={!item.isCompleted}
                            >
                              <FileDown className="h-4 w-4" />
                              Export to PDF
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => {
                                if (!canUpdate) return;
                                setRowToDelete(item);
                                setDeleteOpen(true);
                              }}
                              className="flex items-center gap-2 text-red-600 focus:text-red-700"
                              disabled={item.isCompleted || !canUpdate}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      No inventory counts found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between space-x-2 py-4">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to{" "}
                {Math.min(endIndex, filteredData.length)} of{" "}
                {filteredData.length} results
              </div>
              <div className="flex items-center space-x-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(prev - 1, 1))
                  }
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>
                <div className="flex items-center space-x-1">
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
                    setCurrentPage((prev) => Math.min(prev + 1, totalPages))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation dialog */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete inventory</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium">
                {rowToDelete?.reference ?? "this inventory"}
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rowToDelete && handleDelete(rowToDelete)}
              className="bg-red-600 hover:bg-red-700"
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

