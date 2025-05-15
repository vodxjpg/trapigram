"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  CalendarIcon,
  MoreVertical,
  CreditCard,
  Mail,
  XCircle,
} from "lucide-react";
import { format, startOfDay, endOfDay, subWeeks, subMonths } from "date-fns";

// Define order status types
type OrderStatus = "open" | "paid" | "cancelled" | "completed";

// Define order interface
interface Order {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  status: OrderStatus;
  createdAt: string; // incoming ISO string
  total: number;
}

// Date filter options
type DateFilterOption = "all" | "today" | "last-week" | "last-month" | "custom";

export default function OrdersPage() {
  const router = useRouter();

  // ◼︎ state for all orders via API
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ◼︎ filters & UI state
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilterOption>("all");
  const [dateRange, setDateRange] = useState<{
    from: Date | undefined;
    to: Date | undefined;
  }>({ from: undefined, to: undefined });

  // — fetch orders from /api/orders on mount
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

  // — apply filters whenever inputs or orders change
  useEffect(() => {
    let result = orders.map((o) => ({
      ...o,
      createdAt: new Date(o.createdAt).toString(), // ensure Date
    })) as unknown as Order[];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (o) =>
          o.id.toLowerCase().includes(q) || o.email.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== "all") {
      result = result.filter((o) => o.status === statusFilter);
    }

    if (dateFilter !== "all") {
      const now = new Date();
      if (dateFilter === "today") {
        const start = startOfDay(now);
        result = result.filter((o) => new Date(o.createdAt) >= start);
      } else if (dateFilter === "last-week") {
        const since = startOfDay(subWeeks(now, 1));
        result = result.filter((o) => new Date(o.createdAt) >= since);
      } else if (dateFilter === "last-month") {
        const since = startOfDay(subMonths(now, 1));
        result = result.filter((o) => new Date(o.createdAt) >= since);
      } else if (dateFilter === "custom" && dateRange.from) {
        const from = startOfDay(dateRange.from);
        const to = dateRange.to ? endOfDay(dateRange.to) : endOfDay(now);
        result = result.filter(
          (o) => new Date(o.createdAt) >= from && new Date(o.createdAt) <= to
        );
      }
    }

    setFilteredOrders(result);
  }, [orders, searchQuery, statusFilter, dateFilter, dateRange]);

  const getStatusColor = (s: OrderStatus) => {
    switch (s) {
      case "open":
        return "bg-blue-500";
      case "paid":
        return "bg-green-500";
      case "cancelled":
        return "bg-red-500";
      case "completed":
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  const handleOrderAction = (orderId: string, action: string) => {
    console.log(`Performing ${action} on order ${orderId}`);
    if (action === "cancel") {
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? { ...o, status: "cancelled" } : o))
      );
    } else if (action === "initiate-payment") {
      alert(`Payment initiated for order ${orderId}`);
    } else if (action === "send-notification") {
      alert(`Payment notification sent for order ${orderId}`);
    }
  };

  const formatDate = (dateStr: string) =>
    format(new Date(dateStr), "MMM dd, yyyy");

  // Function to handle date filter change
  const handleDateFilterChange = (value: DateFilterOption) => {
    setDateFilter(value);

    // Reset custom date range if not using custom filter
    if (value !== "custom") {
      setDateRange({ from: undefined, to: undefined });
    }
  };

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
              onValueChange={(value) => setStatusFilter(value)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>

            {/* Date Filter */}
            <Select
              value={dateFilter}
              onValueChange={(value) =>
                handleDateFilterChange(value as DateFilterOption)
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
                    {dateRange.from ? (
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
                    onSelect={(range) =>
                      setDateRange(range || { from: undefined, to: undefined })
                    }
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
                  <TableHead>Order ID</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-medium">
                        <Button
                          variant="link"
                          className="p-0 h-auto font-medium"
                          onClick={() => router.push(`/orders/${order.id}`)}
                        >
                          {order.id}
                        </Button>
                      </TableCell>
                      <TableCell>
                        {order.firstName} {order.lastName} — {order.username} (
                        {order.email})
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(order.status)}>
                          {order.status.charAt(0).toUpperCase() +
                            order.status.slice(1)}
                        </Badge>
                      </TableCell>
                      <TableCell>{formatDate(order.createdAt)}</TableCell>
                      <TableCell>${order.total.toFixed(2)}</TableCell>
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="h-4 w-4" />
                              <span className="sr-only">Open menu</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onClick={() =>
                                handleOrderAction(order.id, "send-notification")
                              }
                              disabled={
                                order.status === "cancelled" ||
                                order.status === "completed"
                              }
                            >
                              <Mail className="mr-2 h-4 w-4" />
                              <span>Send Payment Notification</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                handleOrderAction(order.id, "cancel")
                              }
                              className="text-red-600"
                              disabled={
                                order.status === "cancelled" ||
                                order.status === "completed"
                              }
                            >
                              <XCircle className="mr-2 h-4 w-4" />
                              <span>Cancel Order</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-6">
                      No orders found matching your filters
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
