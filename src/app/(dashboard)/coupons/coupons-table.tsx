// File: src/components/CouponsTable.tsx
"use client";

import React, {
  useState,
  useEffect,
  startTransition,
  type FormEvent,
  useRef,
  DragEvent,
} from "react";
import { useRouter } from "next/navigation";
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
  Copy,
  Upload,
  Download,
  X,
} from "lucide-react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useDebounce } from "@/hooks/use-debounce";

import { Badge } from "@/components/ui/badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";

import { toast } from "sonner";

type Coupon = {
  id: string;
  name: string;
  code: string;
  description: string;
  discountType: "fixed" | "percentage";
  discountAmount: number;
  startDate: string;
  expirationDate: string | null;
  limitPerUser: number;
  usageLimit: number;
  usagePerUser: number;
  expendingMinimum: number;
  expendingLimit: number;
  countries: string[];
  visibility: boolean;
};

const fmtLocal = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export function CouponsTable() {
  const router = useRouter();

  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canCreate, isLoading: permLoading } = useHasPermission(
    organizationId,
    { coupon: ["create"] }
  );
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    coupon: ["update"],
  });
  const { hasPermission: canDelete } = useHasPermission(organizationId, {
    coupon: ["delete"],
  });

  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const debounced = useDebounce(searchQuery, 300);
  const [pageSize, setPageSize] = useState(10);
  const [sortColumn, setSortColumn] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [couponToDelete, setCouponToDelete] = useState<Coupon | null>(null);

  // Import/Export state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);

  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/coupons?page=${currentPage}&pageSize=${pageSize}&search=${encodeURIComponent(
          debounced
        )}`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Failed to fetch coupons");
      const data = await res.json();
      console.log(data);
      setCoupons(data.coupons);
      setTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, [currentPage, pageSize, debounced]);

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(col);
      setSortDirection("asc");
    }
  };

  const sortedCoupons = [...coupons].sort((a, b) => {
    if (sortColumn === "name") {
      return sortDirection === "asc"
        ? a.name.localeCompare(b.name)
        : b.name.localeCompare(a.name);
    }
    if (sortColumn === "usageLimit") {
      return sortDirection === "asc"
        ? a.usageLimit - b.usageLimit
        : b.usageLimit - a.usageLimit;
    }
    return 0;
  });

  const handleDuplicate = async (id: string) => {
    try {
      const res = await fetch(`/api/coupons/${id}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Duplication failed");
      toast.success("Coupon duplicated");
      fetchCoupons();
    } catch {
      toast.error("Failed to duplicate coupon");
    }
  };

  const handleEdit = (c: Coupon) => router.push(`/coupons/${c.id}`);
  const handleAdd = () => router.push("/coupons/new");

  const confirmDelete = async () => {
    if (!couponToDelete) return;
    try {
      const res = await fetch(`/api/coupons/${couponToDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete coupon");
      toast.success("Coupon deleted successfully");
      setCouponToDelete(null);
      fetchCoupons();
    } catch {
      toast.error("Failed to delete coupon");
    }
  };

  // Export handler
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const res = await fetch("/api/coupons/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ coupons: sortedCoupons }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "coupons.xlsx";
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
      const res = await fetch("/api/coupons/import", {
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
          `✅ ${data.successCount} coupon(s) created\n✅ ${data.editCount} updated`
        );
        fetchCoupons();
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

  if (permLoading) return null;

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

      {/* import modalss */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md relative">
            <button
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
              onClick={closeImportModal}
            >
              <X size={20} />
            </button>
            <h2 className="text-xl font-semibold mb-4">Import Coupons</h2>
            <p className="text-left">
              <a
                className="text-blue-600"
                href="https://bjol9ok8s3a6bkjs.public.blob.vercel-storage.com/coupons.xlsx"
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

      {/* Header / Toolbar */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setCurrentPage(1);
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search coupons…"
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) =>
                startTransition(() => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                })
              }
            />
          </div>
          <Button type="submit">Search</Button>
        </form>

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
              <Button onClick={handleAdd} disabled={isImporting || isExporting}>
                <Plus className="mr-2 h-4 w-4" />
                Add Coupon
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Expiration Date</TableHead>
              <TableHead>Limit / User</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("usageLimit")}
              >
                Usage Limit{" "}
                {sortColumn === "usageLimit" &&
                  (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Usage Per User</TableHead>
              <TableHead>Expending Min</TableHead>
              <TableHead>Expending Limit</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : sortedCoupons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="h-24 text-center">
                  No coupons found.
                </TableCell>
              </TableRow>
            ) : (
              sortedCoupons.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>{c.name}</TableCell>
                  <TableCell>{c.code}</TableCell>
                  <TableCell>{c.description}</TableCell>
                  <TableCell>
                    {c.discountType === "percentage"
                      ? `${c.discountAmount}%`
                      : c.discountAmount}
                  </TableCell>
                  <TableCell>{fmtLocal(c.startDate)}</TableCell>
                  <TableCell>{fmtLocal(c.expirationDate)}</TableCell>
                  <TableCell>{c.limitPerUser}</TableCell>
                  <TableCell>{c.usageLimit}</TableCell>
                  <TableCell>{c.usagePerUser}</TableCell>
                  <TableCell>{c.expendingMinimum}</TableCell>
                  <TableCell>{c.expendingLimit}</TableCell>
                  <TableCell>
                    {c.countries.map((ct) => (
                      <Badge key={ct} variant="outline" className="mr-1">
                        {ct}
                      </Badge>
                    ))}
                  </TableCell>
                  <TableCell>{c.visibility ? "Visible" : "Hidden"}</TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canUpdate && (
                          <DropdownMenuItem onClick={() => handleEdit(c)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit
                          </DropdownMenuItem>
                        )}
                        {canUpdate && (
                          <DropdownMenuItem
                            onClick={() => handleDuplicate(c.id)}
                          >
                            <Copy className="mr-2 h-4 w-4" /> Duplicate
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <DropdownMenuItem
                            onClick={() => setCouponToDelete(c)}
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

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
          <p className="text-sm font-medium">Rows / page</p>
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              setPageSize(Number(v));
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
          <div className="flex items-center space-x-2">
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
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
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
      </div>

      {/* Delete-confirmation dialog */}
      <AlertDialog
        open={!!couponToDelete}
        onOpenChange={(open) => !open && setCouponToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete “{couponToDelete?.name}”? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
