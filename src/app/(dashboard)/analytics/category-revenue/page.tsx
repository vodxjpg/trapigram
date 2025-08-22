// src/app/(dashboard)/analytics/category-revenue/page.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useIsMobile } from "@/hooks/use-mobile";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  type ChartConfig,
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
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CategoryRevenue = {
  category: string;
  total: number;
  cost: number;
  revenue: number;
};

type CustomDateRange = { from: Date; to: Date };

const chartConfig = {
  revenue: {
    label: "Revenue",
    color: "hsl(var(--chart-1))",
  },
} satisfies ChartConfig;

export default function CategoryRevenueReport() {
  const router = useRouter();

  // --- Permissions (always call hooks, never conditionally) ---
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(orgId, { categoriesReport: ["view"] });
  const { hasPermission: canExport, isLoading: exportLoading } = useHasPermission(orgId, { categoriesReport: ["export"] });

  // Redirect effect (still declared every render)
  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/analytics");
  }, [viewLoading, canView, router]);

  // Derived flags to gate fetch/UI safely
  const permsLoading = viewLoading || exportLoading;
  const canShow = !permsLoading && canView;

  // --- Local state hooks (always declared) ---
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
  const [currency, setCurrency] = useState<"USD" | "GBP" | "EUR">("USD");
  const [categories, setCategories] = useState<CategoryRevenue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chartData, setChartData] = useState<CategoryRevenue[]>([]);

  const isMobile = useIsMobile(); // OK even if unused; keeps hooks order stable

  const rowsPerPage = 25;

  // Fetch data when allowed
  useEffect(() => {
    if (!canShow) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const from = encodeURIComponent(dateRange.from.toISOString());
        const to = encodeURIComponent(dateRange.to.toISOString());
        const res = await fetch(
          `/api/report/categoryRevenue?from=${from}&to=${to}&currency=${currency}`
        );
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setCategories(Array.isArray(data.categories) ? data.categories : []);
          setChartData(Array.isArray(data.categories) ? data.categories : []);
          setCurrentPage(1);
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message || "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dateRange, currency, canShow]);

  // Sort without mutating state
  const filteredCategories = useMemo(
    () => [...categories].sort((a, b) => b.revenue - a.revenue),
    [categories]
  );

  const totalPages = Math.ceil(filteredCategories.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentCategories = filteredCategories.slice(startIndex, endIndex);

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
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

  const exportToExcel = () => {
    if (!canExport) return; // permission guard
    const dataForSheet = categories.map((c) => ({
      Category: c.category,
      Total: c.total,
      Cost: c.cost,
      Revenue: c.revenue,
    }));
    const ws = XLSX.utils.json_to_sheet(dataForSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Category Revenue");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `category-revenue-report_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 🔒 UI gates AFTER all hooks are declared
  if (permsLoading) return <div>Loading permissions…</div>;
  if (!canShow) return null; // redirect effect handles denial

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Category Revenue Report</CardTitle>
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
                    {p.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
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
                        onSelect={(range) => setTempDateRange(range)}
                        numberOfMonths={2}
                      />
                      <div className="flex items-center justify-between pt-4 border-t mt-4">
                        <div className="text-sm text-muted-foreground">
                          {tempDateRange?.from && tempDateRange?.to
                            ? `${format(tempDateRange.from, "MMM dd, yyyy")} - ${format(tempDateRange.to, "MMM dd, yyyy")}`
                            : "Select date range"}
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={handleCustomDateCancel}>
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            onClick={handleCustomDateApply}
                            disabled={!tempDateRange?.from || !tempDateRange?.to}
                          >
                            Apply
                          </Button>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Currency + Export */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Currency</span>
                <Select value={currency} onValueChange={(v) => setCurrency(v as "USD" | "GBP" | "EUR")}>
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="default"
                  size="sm"
                  className="shrink-0"
                  onClick={exportToExcel}
                  disabled={!canExport}
                  title={canExport ? "Export to Excel" : "You don't have permission to export"}
                >
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Export to Excel
                </Button>
              </div>
            </div>

            {/* Status */}
            {loading && <div>Loading category revenue…</div>}
            {error && <div className="text-red-600">Error: {error}</div>}

            {!loading && !error && (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {filteredCategories.length} categories from{" "}
                  {format(dateRange.from, "MMM dd, yyyy")} to{" "}
                  {format(dateRange.to, "MMM dd, yyyy")}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Cost</TableHead>
                        <TableHead className="text-right">Revenue</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentCategories.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                            No categories found for the selected date range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        currentCategories.map((category, index) => (
                          <TableRow key={`${category.category}-${index}`}>
                            <TableCell className="font-medium">{category.category}</TableCell>
                            <TableCell className="text-right">{formatCurrency(category.total)}</TableCell>
                            <TableCell className="text-right">{formatCurrency(category.cost)}</TableCell>
                            <TableCell className="text-right font-medium text-green-600">
                              {formatCurrency(category.revenue)}
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
                      Showing {startIndex + 1} to {Math.min(endIndex, filteredCategories.length)} of{" "}
                      {filteredCategories.length} categories
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
                        {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
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
                              variant={currentPage === num ? "default" : "outline"}
                              className="w-8 h-8 p-0"
                              onClick={() => setCurrentPage(num)}
                            >
                              {num}
                            </Button>
                          );
                        })}
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
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
            <CardTitle>Revenue by Category</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={chartConfig} className="aspect-auto h-[400px] w-full">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="category" dataKey="category" tick={{ fontSize: 12 }} />
                <YAxis type="number" tickFormatter={(value) => formatCurrency(value)} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value) => [formatCurrency(Number(value)), ""]}
                      labelFormatter={(label) => `Category: ${label}`}
                    />
                  }
                />
                <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
