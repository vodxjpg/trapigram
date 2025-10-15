// src/app/(dashboard)/orders/page.tsx (or your current path)
"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import Link from "next/link";
import { type DateRange } from "react-day-picker";
import { useRouter } from "next/navigation";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Edit,
  MoreVertical,
  Search,
  Truck,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { format, startOfDay, endOfDay, subWeeks, subMonths } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";

/* NEW: TanStack + standardized table */
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ------------------------------------------------------------------ */
/*  Types & helpers                                                   */
/* ------------------------------------------------------------------ */
type OrderStatus =
  | "open"
  | "underpaid"
  | "pending_payment"
  | "paid"
  | "cancelled"
  | "refunded"
  | "completed";

const STATUS_LABELS: Record<OrderStatus, string> = {
  open: "Open",
  underpaid: "Partially paid",
  pending_payment: "Pending payment",
  paid: "Paid",
  cancelled: "Cancelled",
  refunded: "Refunded",
  completed: "Completed",
};
const statusLabel = (s: OrderStatus) => STATUS_LABELS[s] ?? s.replace(/_/g, " ");

interface Order {
  id: string;
  orderKey: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: OrderStatus;
  createdAt: string;
  total: number;
  shippingCompany?: string;
  trackingNumber?: string;
  country?: string;
}
type DateFilterOption = "all" | "today" | "last-week" | "last-month" | "custom";
type ShippingCompany = { id: string; name: string };

/* currency helpers */
const EUROZONE = new Set([
  "AT",
  "BE",
  "CY",
  "DE",
  "EE",
  "ES",
  "FI",
  "FR",
  "GR",
  "IE",
  "IT",
  "LT",
  "LU",
  "LV",
  "MT",
  "NL",
  "PT",
  "SI",
  "SK",
  "AD",
  "MC",
  "SM",
  "VA",
  "ME",
  "XK",
]);
const STERLING = new Set(["GB", "UK", "GG", "JE", "IM"]);
const USD_ZONES = new Set(["US", "PR", "GU", "AS", "MP", "VI"]);
const COUNTRY_ALIAS: Record<string, string> = {
  UK: "GB",
  UNITEDKINGDOM: "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  NORTHERNIRELAND: "GB",
  USA: "US",
  UNITEDSTATES: "US",
  UNITEDSTATESOFAMERICA: "US",
};
type SupportedCcy = "EUR" | "GBP" | "USD";
const norm = (s?: string) =>
  (s ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
const currencyForCountry = (country?: string): SupportedCcy => {
  if (!country) return "USD";
  const raw = norm(country);
  const c = COUNTRY_ALIAS[raw] ?? raw;
  if (EUROZONE.has(c)) return "EUR";
  if (STERLING.has(c)) return "GBP";
  if (USD_ZONES.has(c)) return "USD";
  return "USD";
};
export const formatMoneyByCountry = (amount: number, country?: string) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyForCountry(country),
  }).format(amount);

const getStatusColor = (s: OrderStatus) => {
  switch (s) {
    case "open":
      return "bg-blue-500";
    case "pending_payment":
      return "bg-yellow-500";
    case "paid":
      return "bg-green-500";
    case "cancelled":
    case "refunded":
      return "bg-red-500";
    case "underpaid":
      return "bg-orange-500";
    case "completed":
      return "bg-purple-500";
    default:
      return "bg-gray-500";
  }
};
const formatDate = (d: string) => format(new Date(d), "MMM dd, yyyy");

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export default function OrdersPage() {
  const router = useRouter();

  /* org + permissions */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: canViewDetail } = useHasPermission(organizationId, {
    order: ["view"],
  });
  const { hasPermission: canViewPricing } = useHasPermission(organizationId, {
    order: ["view_pricing"],
  });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, {
    order: ["update"],
  });
  const { hasPermission: canUpdateTracking } = useHasPermission(
    organizationId,
    { order: ["update_tracking"] },
  );
  const {
    hasPermission: canUpdateStatus,
    isLoading: permissionsLoading,
  } = useHasPermission(organizationId, { order: ["update_status"] });

  /* data + ui state */
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* filters */
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilterOption>("all");
  const [dateRange, setDateRange] = useState<DateRange>();

  /* pagination */
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  /* shipping */
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>(
    [],
  );
  const [shippingLoading, setShippingLoading] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [draftTracking, setDraftTracking] = useState("");

  /* fetch orders */
  useEffect(() => {
    setLoading(true);
    fetch("/api/order")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch orders");
        return res.json();
      })
      .then((data: Order[]) => {
        setOrders(data);
        setError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /* memo filters */
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (o) =>
          String(o.orderKey).toLowerCase().includes(q) ||
          (o.email ?? "").toLowerCase().includes(q) ||
          `${o.firstName} ${o.lastName}`.toLowerCase().includes(q) ||
          (o.username ?? "").toLowerCase().includes(q),
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter);
    }

    if (dateFilter !== "all") {
      const now = new Date();
      const created = (d: string) => new Date(d);

      if (dateFilter === "today") {
        const from = startOfDay(now);
        result = result.filter((o) => created(o.createdAt) >= from);
      } else if (dateFilter === "last-week") {
        const from = startOfDay(subWeeks(now, 1));
        result = result.filter((o) => created(o.createdAt) >= from);
      } else if (dateFilter === "last-month") {
        const from = startOfDay(subMonths(now, 1));
        result = result.filter((o) => created(o.createdAt) >= from);
      } else if (dateFilter === "custom" && dateRange?.from) {
        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(now);
        result = result.filter(
          (o) =>
            created(o.createdAt) >= from && created(o.createdAt) <= to,
        );
      }
    }

    return result;
  }, [orders, searchQuery, statusFilter, dateFilter, dateRange]);

  /* keep pagination sane on filter changes */
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, dateFilter, dateRange]);

  const pageCount = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );

  const handleDateFilterChange = (opt: DateFilterOption) => {
    setDateFilter(opt);
    if (opt !== "custom") setDateRange(undefined);
  };

  /* actions */
  const handleStatusChange = useCallback(
    async (orderId: string, newStatus: OrderStatus) => {
      try {
        const res = await fetch(`/api/order/${orderId}/change-status`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(payload?.error || "Failed to update status");

        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
        );

        if (Array.isArray(payload?.warnings)) {
          payload.warnings.forEach((msg: string) => msg && toast.warning(msg));
        }
      } catch (err: any) {
        console.error(err);
        toast.error(err?.message || "Error updating order status");
      }
    },
    [],
  );

  const handleTracking = useCallback(
    (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;
      setSelectedOrderId(orderId);
      setDraftTracking(order.trackingNumber ?? "");
      setDialogOpen(true);
    },
    [orders],
  );

  /* fetch shipping companies on dialog open */
  useEffect(() => {
    if (!dialogOpen) return;
    (async () => {
      setShippingLoading(true);
      try {
        const res = await fetch("/api/shipping-companies", {
          headers: {
            "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET!,
          },
        });
        if (!res.ok) throw new Error("Failed to fetch shipping companies");
        const { shippingMethods } = await res.json();
        setShippingCompanies(shippingMethods);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setShippingLoading(false);
      }
    })();
  }, [dialogOpen]);

  /* pre-select saved company when dialog opens */
  useEffect(() => {
    if (!dialogOpen || !selectedOrderId || shippingCompanies.length === 0) return;
    const order = orders.find((o) => o.id === selectedOrderId);
    if (!order?.shippingCompany) return;
    const match = shippingCompanies.find((c) => c.name === order.shippingCompany);
    if (match) setSelectedCompany(match.id);
  }, [dialogOpen, selectedOrderId, shippingCompanies, orders]);

  const saveTracking = async () => {
    if (!selectedOrderId || !selectedCompany) return;
    const company = shippingCompanies.find((c) => c.id === selectedCompany);
    if (!company) return;
    try {
      const res = await fetch(
        `/api/order/${selectedOrderId}/tracking-number`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackingNumber: draftTracking,
            shippingCompany: company.name,
          }),
        },
      );
      if (!res.ok) throw new Error("Failed to save tracking number");
      setOrders((prev) =>
        prev.map((o) =>
          o.id === selectedOrderId
            ? {
                ...o,
                trackingNumber: draftTracking,
                shippingCompany: company.name,
                status: "completed",
              }
            : o,
        ),
      );
      toast.success("Tracking number saved");
      setDialogOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not save tracking");
    }
  };

  /* -------------------- Columns for StandardDataTable -------------------- */
  const columns: ColumnDef<Order>[] = useMemo(() => {
    const base: ColumnDef<Order>[] = [
      {
        accessorKey: "orderKey",
        header: "Order #",
        cell: ({ row }) =>
          canViewDetail ? (
            <Button variant="link" className="p-0 h-auto font-medium" asChild>
              <Link
                href={`/orders/${row.original.id}`}
                prefetch={false}
                onClick={(e) => {
                  // Avoid row-level handlers (selection/expansion) from interfering
                  e.stopPropagation();
                }}
                aria-label={`Open order ${row.original.orderKey}`}
              >
                {row.original.orderKey}
              </Link>
            </Button>
          ) : (
            <span className="font-medium text-muted-foreground cursor-not-allowed">
              {row.original.orderKey}
            </span>
          ),
      },
      {
        id: "user",
        header: "User",
        cell: ({ row }) => {
          const o = row.original;
          return (
            <span>
              {o.firstName} {o.lastName} — {o.username} ({o.email})
            </span>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const o = row.original;
          return canUpdateStatus ? (
            <Select
              value={o.status}
              onValueChange={(v) => handleStatusChange(o.id, v as OrderStatus)}
            >
              <SelectTrigger className="w-auto flex justify-center">
                <Badge className={getStatusColor(o.status)}>
                  {statusLabel(o.status)}
                </Badge>
              </SelectTrigger>
              <SelectContent>
                {(
                  [
                    "open",
                    "underpaid",
                    "pending_payment",
                    "paid",
                    "completed",
                    "cancelled",
                    "refunded",
                  ] as OrderStatus[]
                ).map((s) => (
                  <SelectItem
                    key={s}
                    value={s}
                    className="w-auto flex justify-left"
                  >
                    <Badge className={getStatusColor(s)}>{statusLabel(s)}</Badge>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Badge className={getStatusColor(o.status)}>
              {statusLabel(o.status)}
            </Badge>
          );
        },
      },
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) => formatDate(row.original.createdAt),
      },
    ];

    if (canViewPricing) {
      base.push({
        id: "total",
        header: "Total",
        cell: ({ row }) =>
          formatMoneyByCountry(row.original.total, row.original.country),
      });
    }

    base.push(
      {
        accessorKey: "shippingCompany",
        header: "Shipping Company",
        cell: ({ row }) =>
          row.original.shippingCompany ?? (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        accessorKey: "trackingNumber",
        header: "Tracking #",
        cell: ({ row }) =>
          row.original.trackingNumber ? (
            <code className="font-mono">{row.original.trackingNumber}</code>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "actions",
        header: () => <div className="text-right">Actions</div>,
        cell: ({ row }) => {
          const o = row.original;
          const canEdit = canUpdate && o.status === "open";
          return (
            <div className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="h-4 w-4" />
                    <span className="sr-only">Open menu</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {canEdit ? (
                    <DropdownMenuItem
                      onClick={() => router.push(`/orders/${o.id}/edit`)}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </DropdownMenuItem>
                  ) : (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div>
                            <DropdownMenuItem
                              onSelect={(e) => e.preventDefault()}
                              aria-disabled="true"
                              className="text-muted-foreground cursor-not-allowed"
                            >
                              <Edit className="mr-2 h-4 w-4" />
                              Edit
                            </DropdownMenuItem>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          Order must be{" "}
                          <span className="font-semibold">Open</span> to edit.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                  {canUpdateTracking && (
                    <DropdownMenuItem onClick={() => handleTracking(o.id)}>
                      <Truck className="mr-2 h-4 w-4" />
                      <span>
                        {o.trackingNumber
                          ? "Update tracking number"
                          : "Set tracking number"}
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    );

    return base;
  }, [
    canViewDetail,
    canViewPricing,
    canUpdate,
    canUpdateStatus,
    canUpdateTracking,
    handleStatusChange,
    handleTracking,
    router,
  ]);

  /* TanStack instance — feed the paginated slice to keep your current paging */
  const table = useReactTable({
    data: paginatedOrders,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* render guards for permission only; let table show loading/empty states */
  if (permissionsLoading)
    return <div className="container mx-auto py-8 px-4">Loading permissions…</div>;

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      {/* Page title */}
      <div>
        <h1 className="text-3xl font-bold">Orders</h1>
        <p className="text-muted-foreground mt-1">
          Manage and track all customer orders
        </p>
      </div>

      {/* Filters (no Card) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by order ID or email"
            className="pl-8"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Status */}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
          <SelectTrigger>
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending_payment">Pending payment</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="underpaid">Underpaid</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
            <SelectItem value="refunded">Refunded</SelectItem>
          </SelectContent>
        </Select>

        {/* Date preset */}
        <Select
          value={dateFilter}
          onValueChange={(v) => handleDateFilterChange(v as DateFilterOption)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Filter by date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Time</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="last-week">Last Week</SelectItem>
            <SelectItem value="last-month">Last Month</SelectItem>
            <SelectItem value="custom">Custom Range</SelectItem>
          </SelectContent>
        </Select>

        {/* Custom range */}
        {dateFilter === "custom" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    <>
                      {format(dateRange.from, "LLL dd, y")} -{" "}
                      {format(dateRange.to, "LLL dd, y")}
                    </>
                  ) : (
                    format(dateRange.from, "LLL dd, y")
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={(range) => setDateRange(range)}
                initialFocus
              />
            </PopoverContent>
          </Popover>
        )}
      </div>

      {/* Standardized Table (no Cards) */}
      <StandardDataTable<Order>
        table={table}
        columns={columns}
        isLoading={loading}
        emptyMessage={
          error ? `Error: ${error}` : "No orders found matching your filters"
        }
        skeletonRows={8}
      />

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          Showing{" "}
          <strong>
            {filteredOrders.length === 0
              ? 0
              : (currentPage - 1) * itemsPerPage + 1}{" "}
            to {Math.min(currentPage * itemsPerPage, filteredOrders.length)}
          </strong>{" "}
          of <strong>{filteredOrders.length}</strong> orders
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage === pageCount || pageCount === 0}
            onClick={() => setCurrentPage((p) => Math.min(p + 1, pageCount))}
          >
            Next
          </Button>
        </div>
      </div>

      {/* Tracking Dialog */}
      {canUpdateTracking && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {orders.find((o) => o.id === selectedOrderId)?.trackingNumber
                  ? "Update Tracking Number"
                  : "Set Tracking Number"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <Select
                value={selectedCompany}
                onValueChange={setSelectedCompany}
                disabled={shippingLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={shippingLoading ? "Loading…" : "Select company"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {shippingCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                placeholder="Enter tracking number"
                value={draftTracking}
                onChange={(e) => setDraftTracking(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveTracking}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
