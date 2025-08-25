// src/app/(dashboard)/payment-methods/payment-table.tsx
"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Edit,
  MoreVertical,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { PaymentMethodDrawer } from "./payment-drawer";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

export interface PaymentMethod {
  id: string;
  name: string;
  active: boolean;
  apiKey?: string | null;
  secretKey?: string | null;
}

const TRUSTED = [
  {
    id: "01",
    name: "Niftipay",
    logo: "/niftipay-logo.svg",
  },
] as const;

export function PaymentMethodsTable() {
  const router = useRouter();

  /* active organization for permission scope */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* permissions */
  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { payment: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(organizationId, { payment: ["create"] });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, { payment: ["update"] });
  const { hasPermission: canDelete } = useHasPermission(organizationId, { payment: ["delete"] });

  /* state */
  const [methods, setMethods]       = useState<PaymentMethod[]>([]);
  const [loading, setLoading]       = useState(true);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages]   = useState(1);
  const [pageSize, setPageSize]     = useState(10);
  const [searchQuery, setSearchQuery] = useState("");

  const [drawerOpen, setDrawerOpen]   = useState(false);
  const [drawerMode, setDrawerMode]   = useState<"niftipay" | "custom">("custom");
  const [editing, setEditing]         = useState<PaymentMethod | null>(null);
  const [providerDialog, setProviderDialog] = useState(false);

  /* fetch */
  const fetchMethods = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({
        page: String(currentPage),
        pageSize: String(pageSize),
        search: searchQuery,
      });
      const res = await fetch(`/api/payment-methods?${qs}`);
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

  /* effects */
  useEffect(() => {
    if (canView) fetchMethods();
  }, [currentPage, pageSize, searchQuery, canView]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  /* guard */
  if (permLoading || !canView) return null;

  const niftipayRow = methods.find((m) => m.name.toLowerCase() === "niftipay") || null;

  /* actions */
  const toggleActive = async (pm: PaymentMethod) => {
    if (!canUpdate) return;
    try {
      await fetch(`/api/payment-methods/${pm.id}/active`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !pm.active }),
      });
      setMethods((prev) =>
        prev.map((m) => (m.id === pm.id ? { ...m, active: !pm.active } : m))
      );
    } catch {
      toast.error("Failed to update status");
    }
  };

  const deleteRow = async (pm: PaymentMethod) => {
    if (!canDelete) return;
    if (pm.name.toLowerCase() === "niftipay") return;
    if (!confirm("Delete this payment method?")) return;
    try {
      await fetch(`/api/payment-methods/${pm.id}`, { method: "DELETE" });
      toast.success("Deleted");
      fetchMethods();
    } catch {
      toast.error("Failed to delete");
    }
  };

  const openDrawer = (
    mode: "niftipay" | "custom",
    row: PaymentMethod | null = null
  ) => {
    if (!(canCreate || canUpdate)) return;
    setDrawerMode(mode);
    setEditing(row);
    setDrawerOpen(true);
  };

  const onDrawerClose = (refresh = false) => {
    setDrawerOpen(false);
    setEditing(null);
    if (refresh) fetchMethods();
  };

  return (
    <div className="space-y-6">
      {/* provider-picker dialog */}
      {canCreate && (
        <Dialog open={providerDialog} onOpenChange={setProviderDialog}>
          <DialogContent className="sm:max-w-[460px]">
            <DialogHeader>
              <DialogTitle>Add a payment method</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-6 mt-4">
              <button
                onClick={() => {
                  setProviderDialog(false);
                  openDrawer("niftipay", niftipayRow);
                }}
                className="border rounded-lg p-4 flex flex-col items-center gap-3 hover:bg-muted/50 transition"
              >
                <Image
                  src={TRUSTED[0].logo}
                  alt="Niftipay"
                  width={48}
                  height={48}
                />
                <span className="font-medium">Niftipay - Accept crypto payments</span>
                <span className="text-xs text-green-600">Trusted provider</span>
              </button>
              <button
                onClick={() => {
                  setProviderDialog(false);
                  openDrawer("custom");
                }}
                className="border rounded-lg p-4 flex flex-col items-center gap-3 hover:bg-muted/50 transition"
              >
                <Plus className="w-8 h-8" />
                <span className="font-medium">Custom method</span>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* header row */}
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
              placeholder="Search…"
              className="pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <Button type="submit">Search</Button>
        </form>
        {canCreate && (
          <Button onClick={() => setProviderDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Payment
          </Button>
        )}
      </div>

      {/* table */}
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
                <TableCell colSpan={3} className="text-center py-6">
                  Loading…
                </TableCell>
              </TableRow>
            ) : methods.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="text-center py-6">
                  No payment methods.
                </TableCell>
              </TableRow>
            ) : (
              methods.map((pm) => (
                <TableRow key={pm.id}>
                  <TableCell className="flex items-center gap-2">
                    {pm.name}
                    {pm.name.toLowerCase() === "niftipay" && (
                      <span className="text-xs text-green-600 ml-2">
                        trusted
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={pm.active}
                      onCheckedChange={() => toggleActive(pm)}
                      disabled={!canUpdate}
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
                        {canUpdate && (
                          <DropdownMenuItem
                            onClick={() =>
                              openDrawer(
                                pm.name.toLowerCase() === "niftipay"
                                  ? "niftipay"
                                  : "custom",
                                pm
                              )
                            }
                          >
                            <Edit className="mr-2 h-4 w-4" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {canDelete && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() => deleteRow(pm)}
                              disabled={pm.name.toLowerCase() === "niftipay"}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Delete
                            </DropdownMenuItem>
                          </>
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

      {/* pagination */}
      <div className="flex items-center justify-between mt-4">
        <div className="text-sm text-muted-foreground">
          Page {currentPage} of {totalPages}
        </div>
        <div className="flex items-center space-x-2">
        <div className="flex-row sm:flex-col">
          <p className="text-sm font-medium">Rows per page</p>
          <Select
            value={String(pageSize)}
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
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          </div>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(1)}
          >
            <ChevronsLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(totalPages)}
          >
            <ChevronsRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <PaymentMethodDrawer
        open={drawerOpen}
        onClose={onDrawerClose}
        mode={drawerMode}
        method={editing}
      />
    </div>
  );
}
