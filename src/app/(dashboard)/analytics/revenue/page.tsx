"use client";

import { useState, useEffect, useMemo } from "react";
import * as XLSX from "xlsx";
import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
} from "lucide-react";
import {
  format,
  subDays,
  subWeeks,
  subMonths,
  subYears,
  startOfDay,
  endOfDay,
} from "date-fns";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Order = {
  id: string;
  datePaid: string; // ISO date string
  orderNumber: string;
  userId: string;
  country: string;
  totalPrice: number;
  shippingCost: number;
  discount: number;
  cost: number;
  asset: string;
  coin: string;
  netProfit: number;
};

type DateRange = { from: Date; to: Date };

export default function OrderReport() {
  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfDay(subDays(new Date(), 30)),
    to: endOfDay(new Date()),
  });
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange>(dateRange);

  // ** NEW: state for real orders **
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rowsPerPage = 25;

  // fetch whenever dateRange changes
  useEffect(() => {
    async function fetchOrders() {
      setLoading(true);
      setError(null);
      try {
        // format the dates as ISO strings or whatever your API expects
        const from = encodeURIComponent(dateRange.from.toISOString());
        const to = encodeURIComponent(dateRange.to.toISOString());
        const res = await fetch(`/api/report/revenue?from=${from}&to=${to}`);
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        // expecting { orders: Order[] }
        setOrders(data.orders);
        setCurrentPage(1);
      } catch (err: any) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchOrders();
  }, [dateRange]);

  // paging and filtering now uses real `orders`
  const filteredOrders = useMemo(() => {
    return orders.sort(
      (a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime()
    );
  }, [orders]);

  const totalPages = Math.ceil(filteredOrders.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentOrders = filteredOrders.slice(startIndex, endIndex);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);

  function handleDatePreset(preset: string) {
    const now = new Date();
    let from: Date;
    let to = endOfDay(now);
    switch (preset) {
      case "today":
        from = startOfDay(now);
        break;
      case "yesterday":
        from = startOfDay(subDays(now, 1));
        to = endOfDay(subDays(now, 1));
        break;
      case "last-week":
        from = startOfDay(subWeeks(now, 1));
        break;
      case "last-month":
        from = startOfDay(subMonths(now, 1));
        break;
      case "last-3-months":
        from = startOfDay(subMonths(now, 3));
        break;
      case "last-year":
        from = startOfDay(subYears(now, 1));
        break;
      case "all":
        from = new Date(0);
        to = endOfDay(new Date(2099, 11, 31));
        break;
      default:
        return;
    }
    setDateRange({ from, to });
  }

  const handleCustomDateApply = () => {
    setDateRange(tempDateRange);
    setCustomDateOpen(false);
  };

  // ** ADD: export to Excel **
  const exportToExcel = () => {
    const dataForSheet = orders.map((o) => ({
      "Paid At": format(new Date(o.datePaid), "yyyy-MM-dd HH:mm"),
      "Order Number": o.orderNumber,
      "User ID": o.userId,
      Country: o.country,
      "Total Price": o.totalPrice,
      "Shipping Cost": o.shippingCost,
      Discount: o.discount,
      Cost: o.cost,
      Asset: o.coin,
      "Net Profit": o.netProfit,
    }));

    const ws = XLSX.utils.json_to_sheet(dataForSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Orders");

    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `order-report_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Order Report</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6 items-start sm:items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {[
                "all",
                "today",
                "yesterday",
                "last-week",
                "last-month",
                "last-3-months",
                "last-year",
              ].map((p) => (
                <Button
                  key={p}
                  variant="outline"
                  size="sm"
                  onClick={() => handleDatePreset(p)}
                >
                  {p
                    .replace(/-/g, " ")
                    .replace(/\b\w/g, (c) => c.toUpperCase())}
                </Button>
              ))}

              <Popover open={customDateOpen} onOpenChange={setCustomDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start text-left"
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    Custom Date Range
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-0">
                  <div className="p-4 space-y-4">
                    <div>
                      <label className="text-sm font-medium">From Date</label>
                      <Calendar
                        mode="single"
                        selected={tempDateRange.from}
                        onSelect={(date) =>
                          date &&
                          setTempDateRange((t) => ({
                            ...t,
                            from: startOfDay(date),
                          }))
                        }
                        initialFocus
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">To Date</label>
                      <Calendar
                        mode="single"
                        selected={tempDateRange.to}
                        onSelect={(date) =>
                          date &&
                          setTempDateRange((t) => ({
                            ...t,
                            to: endOfDay(date),
                          }))
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleCustomDateApply}>
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCustomDateOpen(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            <Button
              variant="default"
              size="sm"
              className="shrink-0"
              onClick={exportToExcel}
            >
              <DownloadIcon className="mr-2 h-4 w-4" />
              Export to Excel
            </Button>
          </div>

          {/* Status */}
          {loading && <div>Loading orders…</div>}
          {error && <div className="text-red-600">Error: {error}</div>}
          {!loading && !error && (
            <>
              <div className="mb-4 text-sm text-muted-foreground">
                Showing {filteredOrders.length} orders from{" "}
                {format(dateRange.from, "MMM dd, yyyy")} to{" "}
                {format(dateRange.to, "MMM dd, yyyy")}
              </div>

              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        "Paid At",
                        "Order Number",
                        "User ID",
                        "Country",
                        "Total Price",
                        "Shipping Cost",
                        "Discount",
                        "Cost",
                        "Asset",
                        "Net Profit",
                      ].map((h) => (
                        <TableHead
                          key={h}
                          className={
                            [
                              "Total Price",
                              "Shipping Cost",
                              "Discount",
                              "Cost",
                              "Net Profit",
                            ].includes(h)
                              ? "text-right"
                              : ""
                          }
                        >
                          {h}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {currentOrders.map((o) => (
                      <TableRow key={o.id}>
                        <TableCell>
                          {format(new Date(o.datePaid), "MMM dd, yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="font-medium">
                          {o.orderNumber}
                        </TableCell>
                        <TableCell>{o.userId}</TableCell>
                        <TableCell>{o.country}</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(o.totalPrice)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(o.shippingCost)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(o.discount)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(o.cost)}
                        </TableCell>
                        <TableCell>{o.coin}</TableCell>
                        <TableCell
                          className={`text-right font-medium ${
                            o.netProfit >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          {formatCurrency(o.netProfit)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {filteredOrders.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No orders found for the selected date range.
                </div>
              )}

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to{" "}
                    {Math.min(endIndex, filteredOrders.length)} of{" "}
                    {filteredOrders.length} orders
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      disabled={currentPage === 1}
                    >
                      <ChevronLeftIcon className="h-4 w-4" /> Previous
                    </Button>
                    <div className="flex items-center space-x-1">
                      {Array.from(
                        { length: Math.min(5, totalPages) },
                        (_, i) => {
                          let num =
                            totalPages <= 5
                              ? i + 1
                              : currentPage <= 3
                                ? i + 1
                                : currentPage >= totalPages - 2
                                  ? totalPages - 4 + i
                                  : currentPage - 2 + i;
                          return (
                            <Button
                              key={num}
                              size="sm"
                              variant={
                                currentPage === num ? "default" : "outline"
                              }
                              className="w-8 h-8 p-0"
                              onClick={() => setCurrentPage(num)}
                            >
                              {num}
                            </Button>
                          );
                        }
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setCurrentPage((p) => Math.min(p + 1, totalPages))
                      }
                      disabled={currentPage === totalPages}
                    >
                      Next <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
