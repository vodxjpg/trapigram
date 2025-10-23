// src/app/(dashboard)/inventory/page.tsx
"use client";

import { useState, useMemo, useEffect, useRef } from "react";
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
import { StandardDataTable } from "@/components/data-table/data-table";

// Create an inline Web Worker that holds the dataset and performs filtering + paging off-thread.
// No external files or deps; works in Next.js client components.
function createInventoryFilterWorker(): { worker: Worker; url: string } {
  const code = `
    let data = [];
    function match(item, q) {
      if (!q) return true;
      const ref = String(item.reference || "").toLowerCase();
      const wh  = String(item.warehouse || "").toLowerCase();
      const ct  = String(item.countType || "").toLowerCase();
      const st  = String(item.startedOn || "").toLowerCase();
      return ref.includes(q) || wh.includes(q) || ct.includes(q) || st.includes(q);
    }
    onmessage = (e) => {
      const { type, payload } = e.data || {};
      if (type === "setData") {
        data = Array.isArray(payload) ? payload : [];
        // tell UI we are ready and how many total items we have
        postMessage({ type: "ready", payload: { size: data.length } });
      } else if (type === "query") {
        const q = (payload?.q || "").toLowerCase();
        const page = Math.max(1, Number(payload?.page || 1));
        const perPage = Math.max(1, Number(payload?.perPage || 10));
        const start = (page - 1) * perPage;
        const end = start + perPage;

        let matchCount = 0;
        const pageRows = [];
        for (let i = 0; i < data.length; i++) {
          const item = data[i];
          if (match(item, q)) {
            if (matchCount >= start && matchCount < end) {
              pageRows.push(item);
            }
            matchCount++;
          }
        }
        postMessage({ type: "result", payload: { matchCount, pageRows } });
      }
    };
  `;
  const blob = new Blob([code], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  const worker = new Worker(url);
  return { worker, url };
}

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

  // search + paging (keep the same variable names and semantics where visible)
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Debounce search to avoid spamming the worker on each keystroke
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm), 250);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // data
  const [inventoryCounts, setInventoryCounts] = useState<InventoryCountRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // delete dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rowToDelete, setRowToDelete] = useState<InventoryCountRow | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);

  // Web Worker refs/state
  const workerRef = useRef<Worker | null>(null);
  const workerUrlRef = useRef<string | null>(null);
  const [workerReady, setWorkerReady] = useState(false);

  // The worker returns just the current page rows + the total filtered count.
  const [pageRows, setPageRows] = useState<InventoryCountRow[]>([]);
  const [filteredCount, setFilteredCount] = useState<number>(0);

  // Fetch list from /api/inventory and normalize
  useEffect(() => {
    let isMounted = true;

    if (!canView) return;

    (async () => {
      try {
        setLoading(true);
        setError(null);
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

        if (!isMounted) return;

        setInventoryCounts(rows);

        // Initialize worker once and send dataset
        if (!workerRef.current) {
          const { worker, url } = createInventoryFilterWorker();
          workerRef.current = worker;
          workerUrlRef.current = url;

          worker.onmessage = (ev: MessageEvent) => {
            const { type, payload } = ev.data || {};
            if (type === "ready") {
              setWorkerReady(true);
              // Immediately request first page with current (possibly empty) query
              worker.postMessage({
                type: "query",
                payload: { q: debouncedSearchTerm, page: 1, perPage: itemsPerPage },
              });
              setCurrentPage(1);
            } else if (type === "result") {
              setFilteredCount(Number(payload?.matchCount || 0));
              setPageRows(Array.isArray(payload?.pageRows) ? payload.pageRows : []);
            }
          };

          worker.postMessage({ type: "setData", payload: rows });
        } else {
          // If worker already exists (re-fetch), update data and re-query page 1
          workerRef.current.postMessage({ type: "setData", payload: rows });
          workerRef.current.postMessage({
            type: "query",
            payload: { q: debouncedSearchTerm, page: 1, perPage: itemsPerPage },
          });
          setCurrentPage(1);
        }
      } catch (e: any) {
        if (isMounted) setError(e?.message ?? "Unknown error");
      } finally {
        if (isMounted) setLoading(false);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [canView]); // re-run if permission flips

  // Query the worker whenever search/page changes (after debounce + when worker is ready)
  useEffect(() => {
    if (!workerReady || !workerRef.current) return;

    // Clamp pages when filter shrinks to fewer results
    const totalPages = Math.max(1, Math.ceil(filteredCount / itemsPerPage));
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
      // We'll query again on next effect run due to state change
      return;
    }

    workerRef.current.postMessage({
      type: "query",
      payload: {
        q: debouncedSearchTerm,
        page: currentPage,
        perPage: itemsPerPage,
      },
    });
  }, [debouncedSearchTerm, currentPage, workerReady, filteredCount]);

  // Cleanup worker on unmount
  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      if (workerUrlRef.current) {
        URL.revokeObjectURL(workerUrlRef.current);
        workerUrlRef.current = null;
      }
    };
  }, []);

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

      // Update worker dataset and refresh current page after deletion
      if (workerRef.current) {
        const newData = inventoryCounts.filter((r) => r.id !== row.id);
        workerRef.current.postMessage({ type: "setData", payload: newData });
        workerRef.current.postMessage({
          type: "query",
          payload: { q: debouncedSearchTerm, page: currentPage, perPage: itemsPerPage },
        });
      }

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

  // ⬇️ Columns for the StandardDataTable
  const columns = useMemo<ColumnDef<InventoryCountRow>[]>(() => [
    { accessorKey: "reference", header: "Reference" },
    { accessorKey: "warehouse", header: "Warehouse" },
    { accessorKey: "countType", header: "Count Type" },
    { accessorKey: "startedOn", header: "Started On" },
    {
      accessorKey: "isCompleted",
      header: "Status",
      cell: ({ row }) => renderStatusBadge(row.original.isCompleted),
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const item = row.original;
        return (
          <div className="text-right">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Open row actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/inventory/${item.id}`} className="flex items-center gap-2">
                    <ExternalLink className="h-4 w-4" />
                    Open
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => item.isCompleted && handleExportExcel(item)}
                  className={`flex items-center gap-2 ${!item.isCompleted ? "cursor-not-allowed opacity-60" : ""}`}
                  disabled={!item.isCompleted}
                >
                  <FileDown className="h-4 w-4" />
                  Export to Excel
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => item.isCompleted && handleExportPDF(item)}
                  className={`flex items-center gap-2 ${!item.isCompleted ? "cursor-not-allowed opacity-60" : ""}`}
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
          </div>
        );
      },
    },
  ], [canUpdate]);

  // Table instance now renders only the current page rows coming from the worker
  const table = useReactTable({
    data: pageRows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Windowed pagination numbers with ellipses (avoid rendering thousands of buttons)
  const totalPages = Math.max(1, Math.ceil(filteredCount / itemsPerPage));
  const pageNumbers = useMemo<(number | "dots")[]>(() => {
    const total = totalPages;
    const current = currentPage;

    if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

    const result: (number | "dots")[] = [];
    const add = (n: number | "dots") => result.push(n);

    add(1);
    const left = Math.max(2, current - 1);
    const right = Math.min(total - 1, current + 1);
    if (left > 2) add("dots");
    for (let p = left; p <= right; p++) add(p);
    if (right < total - 1) add("dots");
    add(total);
    return result;
  }, [currentPage, totalPages]);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filteredCount);

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
      {/* Page title + actions */}
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


      <div className="flex items-center space-x-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search inventory counts..."
            value={searchTerm}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8"
            aria-label="Search inventory counts"
          />
        </div>
      </div>

      {/* Error banner (optional) */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Standard Data Table (no Card wrapper) */}
      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={loading || !workerReady}
        skeletonRows={8}
        emptyMessage={workerReady ? "No inventory counts found" : "Loading…"}
      />

      {/* Pagination */}
      {filteredCount > 0 && totalPages > 1 && (
        <div className="flex items-center justify-between space-x-2 py-4">
          <div className="text-sm text-muted-foreground">
            Showing {filteredCount === 0 ? 0 : startIndex + 1} to {endIndex} of{" "}
            {filteredCount} results
          </div>
          <div className="flex items-center space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setCurrentPage((prev) => Math.max(prev - 1, 1))
              }
              disabled={currentPage === 1}
              aria-label="Previous page"
            >
              Previous
            </Button>
            <div className="flex items-center space-x-1">
              {pageNumbers.map((p, idx) =>
                p === "dots" ? (
                  <span
                    key={`dots-${idx}`}
                    className="px-2 text-sm text-muted-foreground select-none"
                    aria-hidden
                  >
                    …
                  </span>
                ) : (
                  <Button
                    key={p}
                    variant={currentPage === p ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCurrentPage(p)}
                    className="w-8 h-8 p-0"
                    aria-current={currentPage === p ? "page" : undefined}
                    aria-label={`Page ${p}`}
                  >
                    {p}
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
              aria-label="Next page"
            >
              Next
            </Button>
          </div>
        </div>
      )}

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

