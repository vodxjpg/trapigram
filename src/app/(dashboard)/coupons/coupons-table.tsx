// src/components/CouponsTable.tsx
"use client";

import React, { useState, useEffect } from "react";
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
} from "lucide-react";
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
import { toast } from "sonner";
import { usePermission } from "@/hooks/use-permission";

// ─── shadcn/ui AlertDialog ─────────────────────────────────────────────
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
/* ────────────────────────────────────────────────────────────────────── */

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
  expendingLimit: number;
  expendingMinimum: number;
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
  const can = usePermission();


  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalPages, setTotalPages] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageSize, setPageSize] = useState(10);

  // new: coupon selected for deletion
  const [couponToDelete, setCouponToDelete] = useState<Coupon | null>(null);

  const fetchCoupons = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/coupons?page=${currentPage}&pageSize=${pageSize}&search=${searchQuery}`
      );
      if (!res.ok) throw new Error("Failed to fetch coupons");
      const data = await res.json();
      setCoupons(
        data.coupons.map((c: Coupon) => ({
          ...c,
          countries: c.countries ?? [],
        }))
      );
      setTotalPages(data.totalPages);
    } catch (err) {
      console.error(err);
      toast.error("Failed to load coupons");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCoupons();
  }, [currentPage, pageSize, searchQuery]);

  const [sortColumn, setSortColumn] = useState("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
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
      const res = await fetch(`/api/coupons/${id}/duplicate`, { method: "POST" });
      if (!res.ok) throw new Error("Duplication failed");
      toast.success("Coupon duplicated");
      fetchCoupons();
    } catch (err) {
      console.error(err);
      toast.error("Failed to duplicate coupon");
    }
  };

  const handleEdit = (c: Coupon) => {
    console.log(c)
    router.push(`/coupons/${c.id}`)
  };
  const handleAdd = () => router.push("/coupons/new");

  // called when user confirms in AlertDialog
  const confirmDelete = async () => {
    if (!couponToDelete) return;
    try {
      const res = await fetch(`/api/coupons/${couponToDelete.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete coupon");
      toast.success("Coupon deleted successfully");
      setCouponToDelete(null);
      fetchCoupons();
    } catch (err) {
      console.error(err);
      toast.error("Failed to delete coupon");
    }
  };

  const canCreate = can({ coupon: ["create"] });
  const canUpdate = can({ coupon: ["update"] });
  const canDelete = can({ coupon: ["delete"] });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCurrentPage(1);
            fetchCoupons();
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search coupons..."
              className="pl-8 w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={handleAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add Coupon
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead>Discount</TableHead>
              <TableHead>Start Date</TableHead>
              <TableHead>Expiration Date</TableHead>
              <TableHead>Limit Per User</TableHead>
              <TableHead
                className="cursor-pointer"
                onClick={() => handleSort("usageLimit")}
              >
                Usage Limit{" "}
                {sortColumn === "usageLimit" && (sortDirection === "asc" ? "↑" : "↓")}
              </TableHead>
              <TableHead>Expending Minimum</TableHead>
              <TableHead>Expending Limit</TableHead>
              <TableHead>Countries</TableHead>
              <TableHead>Visibility</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={12} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : sortedCoupons.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="h-24 text-center">
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
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                      {canUpdate && (
                        <DropdownMenuItem onClick={() => handleEdit(c)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        )}
                        {canUpdate && (
                        <DropdownMenuItem onClick={() => handleDuplicate(c.id)}>
                          <Copy className="mr-2 h-4 w-4" />
                          Duplicate
                        </DropdownMenuItem>
                      )}
                        {/* instead of direct delete, we set couponToDelete */}
                        {canDelete && (
                        <DropdownMenuItem
                          onClick={() => setCouponToDelete(c)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
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
          <p className="text-sm font-medium">Rows per page</p>
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
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCurrentPage((p) => p + 1)}
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

      {/* ─── shadcn AlertDialog ─────────────────────────────────────────────── */}
      <AlertDialog
        open={!!couponToDelete}
        onOpenChange={(open) => {
          if (!open) setCouponToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Coupon?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{couponToDelete?.name}&quot;?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* ────────────────────────────────────────────────────────────────────── */}
    </div>
  );
}
