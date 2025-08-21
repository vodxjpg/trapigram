"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
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
import type { DateRange } from "react-day-picker";
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
import {
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Order = {
  id: string;
  datePaid: string;
  orderNumber: string;
  cancelled: boolean;
  refunded: boolean; // ← was string
  userId: string;
  username: string;
  country: string;
  totalPrice: number;
  shippingCost: number;
  discount: number;
  cost: number;
  asset: string;
  coin: string;
  netProfit: number;
};

type CustomDateRange = { from: Date; to: Date };

// Updated chartConfig to use Total and Revenue
const chartConfig = {
  total: { label: "Total", color: "var(--color-desktop)" },
  revenue: { label: "Revenue", color: "var(--color-mobile)" },
} satisfies ChartConfig;

export default function OrderReport() {
  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState<CustomDateRange>({
    from: startOfDay(subDays(new Date(), 30)),
    to: endOfDay(new Date()),
  });
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>({
    from: dateRange.from,
    to: dateRange.to,
  });

  // ** NEW: currency state **
  const [currency, setCurrency] = useState<"USD" | "GBP" | "EUR">("USD");

  // ** NEW: state for real orders **
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<
    "all" | "paid" | "refunded" | "cancelled"
  >("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<
    {
      date: string;
      total: number;
      revenue: number;
    }[]
  >([]);
  const isMobile = useIsMobile();

  const rowsPerPage = 25;

  // fetch whenever dateRange or currency changes
  useEffect(() => {
    async function fetchOrders() {
      setLoading(true);
      setError(null);
      try {
        const from = encodeURIComponent(dateRange.from.toISOString());
        const to = encodeURIComponent(dateRange.to.toISOString());

        const res = await fetch(
          `/api/report/revenue?from=${from}&to=${to}&currency=${currency}&status=${status}`
        );
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        console.log(data);
        setOrders(data.orders);
        setChartData(data.chartData);
        setCurrentPage(1);
      } catch (err: any) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchOrders();
  }, [dateRange, currency, status]); // ← added status

  const filteredData = chartData;

  // paging and filtering now uses real `orders`
  const filteredOrders = useMemo(() => {
    const matchesStatus = (o: Order) => {
      switch (status) {
        case "paid":
          // show only orders that are neither cancelled nor refunded
          return o.cancelled === false && o.refunded === false;
        case "cancelled":
          return o.cancelled === true;
        case "refunded":
          return o.refunded === true;
        case "all":
        default:
          return true;
      }
    };

    const list = orders.filter(matchesStatus);

    return list.sort(
      (a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime()
    );
  }, [orders, status]);

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
    if (tempDateRange?.from && tempDateRange?.to) {
      setDateRange({
        from: startOfDay(tempDateRange.from),
        to: endOfDay(tempDateRange.to),
      });
      setCustomDateOpen(false);
    }
  };

  const handleCustomDateCancel = () => {
    setTempDateRange({
      from: dateRange.from,
      to: dateRange.to,
    });
    setCustomDateOpen(false);
  };

  // ** ADD: export to Excel **
  const exportToExcel = () => {
    const dataForSheet = orders.map((o) => {
      let netProfitDisplay;

      if (o.cancelled === true) {
        // Cancelled → always zero
        netProfitDisplay = 0;
      } else if (o.refunded === true) {
        // Refunded → prepend minus sign, ensure numeric
        netProfitDisplay = -Math.abs(Number(o.netProfit) || 0);
      } else {
        // Paid → as-is
        netProfitDisplay = o.netProfit;
      }

      return {
        "Paid At": format(new Date(o.datePaid), "yyyy-MM-dd HH:mm"),
        "Order Number": o.orderNumber,
        Status:
          o.cancelled === true
            ? "Cancelled"
            : o.refunded === true
              ? "Refunded"
              : "Paid",
        "User ID": o.userId,
        Country: o.country,
        "Total Price": o.totalPrice,
        "Shipping Cost": o.shippingCost,
        Discount: o.discount,
        Cost: o.cost,
        Asset: o.coin,
        "Net Profit": netProfitDisplay,
      };
    });

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
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
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
                      className="justify-start text-left min-w-[240px] bg-transparent"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateRange?.from && dateRange?.to ? (
                        <>
                          {format(dateRange.from, "MMM dd, yyyy")} -{" "}
                          {format(dateRange.to, "MMM dd, yyyy")}
                        </>
                      ) : (
                        <span>Pick a date range</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <div className="p-4">
                      <Calendar
                        initialFocus
                        mode="range"
                        defaultMonth={dateRange?.from || new Date()}
                        selected={tempDateRange}
                        onSelect={(range) => {
                          console.log("Date range selected:", range);
                          setTempDateRange(range);
                        }}
                        numberOfMonths={2}
                      />
                      <div className="flex items-center justify-between pt-4 border-t mt-4">
                        <div className="text-sm text-muted-foreground">
                          {tempDateRange?.from && tempDateRange?.to
                            ? `${format(tempDateRange.from, "MMM dd, yyyy")} - ${format(tempDateRange.to, "MMM dd, yyyy")}`
                            : "Select date range"}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={handleCustomDateCancel}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleCustomDateApply}
                            disabled={
                              !tempDateRange?.from || !tempDateRange?.to
                            }
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Currency Select */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Currency</span>
                <Select
                  value={currency}
                  onValueChange={(v) => setCurrency(v as "USD" | "GBP" | "EUR")}
                  className="w-24"
                >
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
                {/* Status Select */}
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Select
                    value={status}
                    onValueChange={(v) =>
                      setStatus(v as "all" | "paid" | "cancelled" | "refunded")
                    }
                    className="w-32"
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
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
                          "Status",
                          "Username",
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
                      {currentOrders.length === 0 ? (
                        <TableRow>
                          <TableCell
                            colSpan={10}
                            className="text-center py-8 text-muted-foreground"
                          >
                            No orders found for the selected date range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        currentOrders.map((o, index) => (
                          <TableRow key={`${o.id}-${index}`}>
                            <TableCell>
                              {format(
                                new Date(o.datePaid),
                                "MMM dd, yyyy HH:mm"
                              )}
                            </TableCell>
                            <TableCell className="font-medium">
                              {o.orderNumber}
                            </TableCell>
                            <TableCell>
                              {o.cancelled === true
                                ? "Cancelled"
                                : o.refunded === true
                                  ? "Refunded"
                                  : "Paid"}
                            </TableCell>
                            <TableCell>
                              <Link href={`/clients/${o.userId || o.id}/info`}>
                                {o.username || o.userId}
                              </Link>
                            </TableCell>

                            <TableCell>{o.country}</TableCell>
                            <TableCell
                              className={`text-right font-medium ${o.cancelled === true || o.refunded === true ? "text-red-600" : ""}`}
                            >
                              {formatCurrency(o.totalPrice)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${o.cancelled === true || o.refunded === true ? "text-red-600" : ""}`}
                            >
                              {formatCurrency(o.shippingCost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${o.cancelled === true || o.refunded === true ? "text-red-600" : ""}`}
                            >
                              {formatCurrency(o.discount)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${o.cancelled === true || o.refunded === true ? "text-red-600" : ""}`}
                            >
                              {formatCurrency(o.cost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${o.cancelled === true || o.refunded === true ? "text-red-600" : ""}`}
                            >
                              {o.coin}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled || o.refunded
                                  ? "text-red-600"
                                  : o.netProfit >= 0
                                    ? "text-green-600"
                                    : "text-red-600"
                              }`}
                            >
                              {o.cancelled ? "0" : formatCurrency(o.netProfit)}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

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
                        onClick={() =>
                          setCurrentPage((p) => Math.max(p - 1, 1))
                        }
                        disabled={currentPage === 1}
                      >
                        <ChevronLeftIcon className="h-4 w-4" /> Previous
                      </Button>
                      <div className="flex items-center space-x-1">
                        {Array.from(
                          { length: Math.min(5, totalPages) },
                          (_, i) => {
                            const num =
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
      <div className="px-4 lg:px-6">
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Total and Revenue</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer
              config={chartConfig}
              className="aspect-auto h-[250px] w-full"
            >
              <AreaChart
                data={filteredData}
                margin={{ top: 20, right: 0, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-desktop)"
                      stopOpacity={1.0}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-desktop)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                  <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--color-mobile)"
                      stopOpacity={0.8}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-mobile)"
                      stopOpacity={0.1}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(value) => {
                    const dt = new Date(`${value}T00:00:00`);
                    return dt.toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    });
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  defaultIndex={isMobile ? -1 : 10}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const dt = new Date(`${value}T00:00:00`);
                        return dt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        });
                      }}
                      indicator="dot"
                    />
                  }
                />
                <Area
                  dataKey="total"
                  type="natural"
                  fill="url(#fillTotal)"
                  stroke="var(--color-total)"
                  stackId="a"
                />
                <Area
                  dataKey="revenue"
                  type="natural"
                  fill="url(#fillRevenue)"
                  stroke="var(--color-revenue)"
                  stackId="a"
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
