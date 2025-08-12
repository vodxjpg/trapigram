"use client";

import { useState, useEffect, useMemo } from "react";
import { type DateRange } from "react-day-picker";
import { useRouter } from "next/navigation";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Edit, Mail, MoreVertical,
  Search, Truck, CalendarIcon
} from "lucide-react";
import {
  Select, SelectContent, SelectItem,
  SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table, TableBody, TableCell,
  TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle }
  from "@/components/ui/card";
import {
  format, startOfDay, endOfDay,
  subWeeks, subMonths
} from "date-fns";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter,
} from "@/components/ui/dialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */
type OrderStatus = "open" | "underpaid" | "paid" | "cancelled" | "refunded" | "completed";

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
}
type DateFilterOption = "all" | "today" | "last-week" | "last-month" | "custom";
type ShippingCompany = { id: string; name: string };

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export default function OrdersPage() {
  const router = useRouter();

  /* ── active organisation id ───────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission flags (new hook) ───────────────────────────────── */
  const { hasPermission: canViewDetail } = useHasPermission(organizationId, { order: ["view"] });
  const { hasPermission: canViewPricing } = useHasPermission(organizationId, { order: ["view_pricing"] });
  const { hasPermission: canUpdate } = useHasPermission(organizationId, { order: ["update"] });
  const { hasPermission: canUpdateTracking } = useHasPermission(organizationId, { order: ["update_tracking"] });
  const {
    hasPermission: canUpdateStatus,
    isLoading: permissionsLoading,
  } = useHasPermission(organizationId, { order: ["update_status"] });

  /* ── orders & ui state ────────────────────────────────────────── */
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [draftTracking, setDraftTracking] = useState("");

  /* filters */
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilterOption>("all");
  const [dateRange, setDateRange] = useState<DateRange>();  // ← correct type

  /* pagination */
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  /* shipping companies */
  const [shippingCompanies, setShippingCompanies] = useState<ShippingCompany[]>([]);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>();

  /* ---------------------------------------------------------------- */
  /*  Data fetching                                                   */
  /* ---------------------------------------------------------------- */
  useEffect(() => {
    setLoading(true);
    fetch("/api/order")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch orders");
        return res.json();
      })
      .then((data: Order[]) => { setOrders(data); setError(null); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Memoised filtering (no state writes → no render loop)           */
  /* ---------------------------------------------------------------- */
  const filteredOrders = useMemo(() => {
    let result = [...orders];

    /* text search ---------------------------------------------------*/
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((o) =>
        String(o.orderKey).toLowerCase().includes(q) ||            // order #
        (o.email ?? "").toLowerCase().includes(q) ||             // e-mail
        `${o.firstName} ${o.lastName}`.toLowerCase().includes(q) ||// full name
        (o.username ?? "").toLowerCase().includes(q),              // username
      );
    }

    /* status filter -------------------------------------------------*/
    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter);
    }

    /* date filter ---------------------------------------------------*/
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
          (o) => created(o.createdAt) >= from && created(o.createdAt) <= to,
        );
      }
    }

    return result;
  }, [orders, searchQuery, statusFilter, dateFilter, dateRange]);

  /* keep pagination sane when filters change ------------------------*/
  useEffect(() => { setCurrentPage(1); }, [
    searchQuery, statusFilter, dateFilter, dateRange,
  ]);

  /* helper to collapse the custom-range picker when needed ----------*/
  const handleDateFilterChange = (opt: DateFilterOption) => {
    setDateFilter(opt);
    if (opt !== "custom") setDateRange(undefined);
  };
  /* ---------------------------------------------------------------- */
  /*  Helpers                                                         */
  /* ---------------------------------------------------------------- */
  const getStatusColor = (s: OrderStatus) => {
    switch (s) {
      case "open": return "bg-blue-500";
      case "paid": return "bg-green-500";
      case "cancelled":
      case "refunded": return "bg-red-500";
      case "underpaid": return "bg-orange-500";
      case "completed": return "bg-purple-500";
      default: return "bg-gray-500";
    }
  };
  /* fetch shipping companies when the dialog opens */
  useEffect(() => {
    if (!dialogOpen) return;
    (async () => {
      setShippingLoading(true);
      try {
        const res = await fetch("/api/shipping-companies", {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET! },
        });
        if (!res.ok) throw new Error("Failed to fetch shipping companies");

        // API returns { shippingMethods: [...] }
        const { shippingMethods } = await res.json();
        setShippingCompanies(shippingMethods);
      } catch (err: any) {
        toast.error(err.message);
      } finally {
        setShippingLoading(false);
      }
    })();
  }, [dialogOpen]);

  /* ------------------------------------------------------------- */
  /*  Pre-select the saved company when the dialog opens            */
  /* ------------------------------------------------------------- */
  useEffect(() => {
    /* dialog not visible yet, or companies not loaded → skip */
    if (!dialogOpen || !selectedOrderId || shippingCompanies.length === 0) return;

    const order = orders.find(o => o.id === selectedOrderId);
    if (!order?.shippingCompany) return;

    /* find the option whose *name* matches what we stored */
    const match = shippingCompanies.find(c => c.name === order.shippingCompany);
    if (match) setSelectedCompany(match.id);
  }, [dialogOpen, selectedOrderId, shippingCompanies, orders]);


  /* ---------------------------------------------------------------- */
  /*  Render guards                                                   */
  /* ---------------------------------------------------------------- */
  if (permissionsLoading) {
    return <div>Loading permissions…</div>;
  }
  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4 text-center">
        Loading orders…
      </div>
    );
  }
  if (error) {
    return (
      <div className="container mx-auto py-8 px-4 text-center text-red-600">
        Error loading orders: {error}
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  const pageCount = Math.ceil(filteredOrders.length / itemsPerPage);
  const paginatedOrders = filteredOrders.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage,
  );
  const formatDate = (d: string) => format(new Date(d), "MMM dd, yyyy");

  /* status / tracking helpers (unchanged) */
  const handleStatusChange = async (orderId: string, newStatus: OrderStatus) => {
    try {
      const res = await fetch(`/api/order/${orderId}/change-status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)),
      );
      toast.success(`Order status changed`);
    } catch (err) {
      console.error(err);
      toast.error("Error updating order status");
    }
  };
  const handleTracking = (orderId: string) => {
    const order = orders.find(o => o.id === orderId)!;
    setSelectedOrderId(orderId);
    setDraftTracking(order.trackingNumber ?? "");
    // find the company ID for the previously saved name (if any):
    const prevCompany = shippingCompanies.find(c => c.name === order.shippingCompany);
    setSelectedCompany(prevCompany?.id);
    setDialogOpen(true);
  };

  const saveTracking = async () => {
    if (!selectedOrderId || !selectedCompany) return;
    const company = shippingCompanies.find((c) => c.id === selectedCompany);
    if (!company) return;
    try {
      const res = await fetch(`/api/order/${selectedOrderId}/tracking-number`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trackingNumber: draftTracking,
          shippingCompany: company.name,
        }),
      });
      if (!res.ok) throw new Error("Failed to save tracking number");
       // Reflect API behavior locally: tracking, company, and status → completed
       setOrders((prev) =>
         prev.map((o) =>
           o.id === selectedOrderId
             ? {
                 ...o,
                 trackingNumber: draftTracking,
                 shippingCompany: company.name,
                 status: "completed",
               }
             : o
         )
       );
      toast.success("Tracking number saved");
      setDialogOpen(false);
    } catch (err) {
      console.error(err);
      toast.error("Could not save tracking");
    }
  };
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Orders</h1>
        <p className="text-muted-foreground mt-1">
          Manage and track all customer orders
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by order ID or email"
                className="pl-8"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* Status Filter */}
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="underpaid">Underpaid</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Date Filter */}
            <Select
              value={dateFilter}
              onValueChange={(v) =>
                handleDateFilterChange(v as DateFilterOption)
              }
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

            {/* Custom Date Range Picker */}
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
                    onSelect={(range) => setDateRange(range)}   // react-day-picker already returns DateRange|undefined
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order #</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  {canViewPricing && <TableHead>Total</TableHead>}
                  <TableHead>Shipping Company</TableHead>
                  <TableHead>Tracking&nbsp;#</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginatedOrders.length > 0 ? (
                  paginatedOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        {canViewDetail ? (
                          <Button
                            variant="link"
                            className="p-0 h-auto font-medium"
                            onClick={() => router.push(`/orders/${order.id}`)}
                          >
                            {order.orderKey}
                          </Button>
                        ) : (
                          <span className="font-medium text-muted-foreground cursor-not-allowed">
                            {order.orderKey}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        {order.firstName} {order.lastName} — {order.username} (
                        {order.email})
                      </TableCell>
                      {/* Status Select showing only badges or editable based on permission */}
                      <TableCell>
                        {canUpdateStatus ? (
                          <Select
                            value={order.status}
                            onValueChange={(v) =>
                              handleStatusChange(order.id, v as OrderStatus)
                            }
                          >
                            <SelectTrigger className="w-auto flex justify-center">
                              <Badge className={getStatusColor(order.status)}>
                                {order.status.charAt(0).toUpperCase() +
                                  order.status.slice(1)}
                              </Badge>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem
                                value="open"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("open")}>
                                  Open
                                </Badge>
                              </SelectItem>
                              <SelectItem
                                value="underpaid"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("underpaid")}>
                                  Partially paid
                                </Badge>
                              </SelectItem>
                              <SelectItem
                                value="paid"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("paid")}>
                                  Paid
                                </Badge>
                              </SelectItem>
                              <SelectItem
                                value="completed"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("completed")}>
                                  Completed
                                </Badge>
                              </SelectItem>
                              <SelectItem
                                value="cancelled"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("cancelled")}>
                                  Cancelled
                                </Badge>
                              </SelectItem>
                              <SelectItem
                                value="refunded"
                                className="w-auto flex justify-left"
                              >
                                <Badge className={getStatusColor("refunded")}>
                                  Refunded
                                </Badge>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={getStatusColor(order.status)}>
                            {order.status.charAt(0).toUpperCase() +
                              order.status.slice(1)}
                          </Badge>
                        )}
                      </TableCell>

                      <TableCell>{formatDate(order.createdAt)}</TableCell>
                      {canViewPricing && (
                        <TableCell>${order.total.toFixed(2)}</TableCell>
                      )}
                      {/* Shipping Company */}
                      <TableCell>
                        {order.shippingCompany ?? (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      {/* Tracking Number */}
                      <TableCell>
                        {order.trackingNumber ? (
                          <code className="font-mono">{order.trackingNumber}</code>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
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
                              <DropdownMenuItem
                                onClick={() =>
                                  router.push(`/orders/${order.id}/edit`)
                                }
                              >
                                <Edit className="mr-2 h-4 w-4" />
                                Edit
                              </DropdownMenuItem>
                            )}
                            {canUpdateTracking && (
                              <DropdownMenuItem
                                onClick={() => handleTracking(order.id)}
                              >
                                <Truck className="mr-2 h-4 w-4" />
                                <span>{order.trackingNumber ? "Update tracking number" : "Set tracking number"}</span>
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={canViewPricing ? 6 : 5}
                      className="text-center py-6"
                    >
                      No orders found matching your filters
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination Controls */}
          <div className="flex items-center justify-between p-4">
            <div>
              Showing{" "}
              <strong>
                {(currentPage - 1) * itemsPerPage + 1} to{" "}
                {Math.min(currentPage * itemsPerPage, filteredOrders.length)}
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
                onClick={() =>
                  setCurrentPage((p) => Math.min(p + 1, pageCount))
                }
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* — Tracking Number Dialog — */}
      {canUpdateTracking && (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {orders.find(o => o.id === selectedOrderId)?.trackingNumber
                  ? "Update Tracking Number"
                  : "Set Tracking Number"}
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {/* NEW: Shipping Company selector */}
              <Select
                value={selectedCompany}
                onValueChange={(val) => setSelectedCompany(val)}
                disabled={shippingLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      shippingLoading ? "Loading…" : "Select company"
                    }
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
