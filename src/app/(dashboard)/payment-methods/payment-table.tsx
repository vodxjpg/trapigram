"use client";

import React, { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  MoreVertical,
  Plus,
  Trash2,
  Edit,
  Search,
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
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { PaymentMethodDrawer } from "./payment-drawer";

type PaymentMethod = {
  id: string;
  name: string;
  active: boolean;
};

export function PaymentMethodsTable() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);

  // fetch list
  const fetchMethods = async () => {
    setLoading(true);
    try {
      const qp = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: searchQuery,
      });
      const res = await fetch(`/api/payment-methods?${qp}`);
      if (!res.ok) throw new Error("Failed to fetch payment methods");
      const data = await res.json();
      setMethods(data.methods);
      setTotalPages(data.totalPages);
      setCurrentPage(data.currentPage);
    } catch (err: any) {
      toast.error(err.message || "Error loading payment methods");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMethods();
  }, [currentPage, pageSize, searchQuery]);

  // toggle active
  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      const res = await fetch(`/api/payment-methods/${id}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !current }),
      });
      if (!res.ok) throw new Error();
      // make sure you update the `active` field (not `isActive`) in state:
      setMethods((m) =>
        m.map((pm) =>
          pm.id === id ? { ...pm, active: !current } : pm
        )
      );
      toast.success(
        `Payment method ${!current ? "activated" : "deactivated"}`
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  // delete
  const handleDelete = async (id: string) => {
    if (!confirm("Delete this payment method?")) return;
    try {
      const res = await fetch(`/api/payment-methods/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Deleted");
      fetchMethods();
    } catch {
      toast.error("Failed to delete");
    }
  };

  // open drawer
  const openNew = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (pm: PaymentMethod) => {
    setEditing(pm);
    setDrawerOpen(true);
  };
  const closeDrawer = (refresh = false) => {
    setDrawerOpen(false);
    setEditing(null);
    if (refresh) fetchMethods();
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setCurrentPage(1);
            fetchMethods();
          }}
          className="flex w-full sm:w-auto gap-2"
        >
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search…"
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        <Button onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          New Payment
        </Button>
      </div>

      {/* Table */}
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  Loading…
                </TableCell>
              </TableRow>
            ) : methods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="h-24 text-center">
                  No payment methods.
                </TableCell>
              </TableRow>
            ) : (
              methods.map((pm) => (
                <TableRow key={pm.id}>
                  <TableCell>{pm.name}</TableCell>
                  <TableCell>
                    <Switch
                      checked={pm.active}
                      onCheckedChange={() =>
                        handleToggleActive(pm.id, pm.active)
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon">
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEdit(pm)}>
                          <Edit className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDelete(pm.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
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
          Page {currentPage} of {totalPages}
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
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {[5, 10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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

      <PaymentMethodDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        method={editing}
      />
    </div>
  );
}
