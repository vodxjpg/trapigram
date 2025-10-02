// src/app/(dashboard)/analytics/products/monthly-product-report.tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  format,
  subDays,
  startOfMonth,
  endOfMonth,
  subMonths,
  startOfDay,
  endOfDay,
} from "date-fns";
import { CalendarIcon } from "lucide-react";

interface ProductStats {
  kind: "product" | "variation" | "affiliate";
  productId?: string | null;
  variationId?: string | null;
  affiliateProductId?: string | null;

  // existing fields...
  id?: string;            // optional, no longer used for linking
  month: string;
  product: string;
  sku: string;
  quantity: number;
}

interface DateRange {
  from: Date;
  to: Date;
}

type DatePreset =
  | "today"
  | "yesterday"
  | "last7days"
  | "last30days"
  | "currentMonth"
  | "lastMonth"
  | "custom";

const fmtYearMonth = (iso: string | null): string =>
  iso ? new Date(iso).toISOString().slice(0, 7) : "—";

const productReportUrl = (r: ProductStats) => {
  // Default kind if missing (derive from which ID is present)
  const kind =
    r.kind ??
    (r.variationId ? "variation" : r.affiliateProductId ? "affiliate" : "product");

  const qs = new URLSearchParams({ kind });

  if (kind === "affiliate" && r.affiliateProductId) {
    qs.set("affiliateProductId", r.affiliateProductId);
  } else if (kind === "variation") {
    if (r.productId) qs.set("productId", r.productId);
    if (r.variationId) qs.set("variationId", r.variationId);
  } else if (kind === "product" && r.productId) {
    qs.set("productId", r.productId);
  }

  return `/analytics/products/daily?${qs.toString()}`;
};
export default function MonthlyProductReport() {
  const router = useRouter();

  // --- Permissions: productsReport.view
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { productsReport: ["view"] }
  );

  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/analytics");
  }, [viewLoading, canView, router]);

  // ❗Never return before hooks – compute flags and gate UI later
  const permsLoading = viewLoading;
  const canShow = !permsLoading && canView;

  const [data, setData] = useState<ProductStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("currentMonth");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [isCustomDate, setIsCustomDate] = useState(false);

  // Generate date range based on preset
  const getDateRangeFromPreset = (preset: DatePreset): DateRange => {
    const today = new Date();
    switch (preset) {
      case "today":
        return { from: startOfDay(today), to: endOfDay(today) };
      case "yesterday":
        const y = subDays(today, 1);
        return { from: startOfDay(y), to: endOfDay(y) };
      case "last7days":
        return { from: subDays(today, 6), to: today };
      case "last30days":
        return { from: subDays(today, 29), to: today };
      case "currentMonth":
        return { from: startOfMonth(today), to: endOfMonth(today) };
      case "lastMonth":
        const lm = subMonths(today, 1);
        return { from: startOfMonth(lm), to: endOfMonth(lm) };
      case "custom":
        return dateRange;
      default:
        return { from: startOfMonth(today), to: endOfMonth(today) };
    }
  };

  const handleDatePresetChange = (value: string) => {
    const preset = value as DatePreset;
    setDatePreset(preset);
    setIsCustomDate(preset === "custom");
    if (preset !== "custom") setDateRange(getDateRangeFromPreset(preset));
  };

  const formatDateRange = () => {
    const { from, to } = dateRange;
    if (datePreset === "today") return "Today";
    if (datePreset === "yesterday") return "Yesterday";
    if (from && to) return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
    return "";
  };

  // Fetch stats — only after permission granted
  useEffect(() => {
    if (!canShow) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");
        // NOTE: new endpoint path & shape
        const res = await fetch(`/api/report/product?from=${fromDate}&to=${toDate}`);
        if (!res.ok) throw new Error("Failed to load product stats");
        const json = await res.json();
        // server returns { stats: [...] }
        const raw: any[] = json?.stats ?? json?.values?.stats ?? [];
        const monthIso = new Date(dateRange.from).toISOString(); // label month with the filter start

        const mapped: ProductStats[] = raw.map((r: any) => ({
          // keep kind & identifiers so productReportUrl has what it needs
          kind:
            r.kind ??
            (r.variationId ? "variation" : r.affiliateProductId ? "affiliate" : "product"),
          productId: r.productId ?? null,
          variationId: r.variationId ?? null,
          affiliateProductId: r.affiliateProductId ?? null,

          // existing view fields
          id: r.variationId ?? r.productId ?? r.affiliateProductId ?? "unknown",
          month: monthIso,
          product: r.title ?? r.product ?? "—",
          sku: r.sku ?? "—",
          quantity: Number(r.quantity ?? r.qty ?? 0) || 0,
        }));

        if (!cancelled) setData(mapped);

      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dateRange, canShow]);

  // Sort by quantity (highest first)
  const sortedData = [...data].sort((a, b) => b.quantity - a.quantity);

  // 🔒 Render gates AFTER all hooks have been called
  if (permsLoading) return <div>Loading permissions…</div>;
  if (!canShow) return null; // redirect will take over
  if (loading) return <div>Loading report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h1 className="text-3xl font-bold mb-4 md:mb-0">Product Performance Report</h1>

        <div className="flex flex-col sm:flex-row gap-4 w/full md:w-auto">
          <Select value={datePreset} onValueChange={handleDatePresetChange}>
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Select date range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="last7days">Last 7 days</SelectItem>
              <SelectItem value="last30days">Last 30 days</SelectItem>
              <SelectItem value="currentMonth">Current month</SelectItem>
              <SelectItem value="lastMonth">Last month</SelectItem>
              <SelectItem value="custom">Custom date range</SelectItem>
            </SelectContent>
          </Select>

          {isCustomDate && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full sm:w-[300px] justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from && dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM d, yyyy")} - {format(dateRange.to, "MMM d, yyyy")}
                    </>
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={{ from: dateRange.from, to: dateRange.to }}
                  onSelect={(range) => {
                    if (range?.from && range?.to) {
                      setDateRange({ from: range.from, to: range.to });
                    }
                  }}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Product Performance: {formatDateRange()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Product Name</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead className="text-right">Quantity Sold</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.length > 0 ? (
                  sortedData.map((row, index) => (
                    <TableRow
                      key={`${row.kind}-${row.productId ?? row.variationId ?? row.affiliateProductId ?? "na"}-${index}`}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => router.push(productReportUrl(row))}
                    >
                      <TableCell>{fmtYearMonth(row.month)}</TableCell>
                      <TableCell>{row.product}</TableCell>
                      <TableCell>{row.sku}</TableCell>
                      <TableCell className="text-right">{row.quantity}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-4">
                      No data available for the selected date range
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Product Sales: {formatDateRange()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full">
            {data.length > 0 ? (
              <ChartContainer
                className="h-[600px] w-full"
                config={{ quantity: { label: "Quantity", color: "hsl(var(--chart-1))" } }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sortedData} margin={{ top: 20, right: 30, left: 20, bottom: 70 }}>
                    <XAxis
                      dataKey="product"
                      angle={-45}
                      textAnchor="end"
                      height={70}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis label={{ value: "Quantity", angle: -90, position: "insideLeft" }} />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "rgba(0, 0, 0, 0.1)" }} />
                    <Bar
                      dataKey="quantity"
                      fill="var(--color-quantity)"
                      radius={[4, 4, 0, 0]}
                      label={{ position: "top", fill: "var(--foreground)", fontSize: 12 }}
                      onClick={(_, index) => router.push(productReportUrl(sortedData[index]))}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No product data available for this date range
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
