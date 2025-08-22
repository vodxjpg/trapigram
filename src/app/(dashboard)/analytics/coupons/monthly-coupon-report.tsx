// src/app/(dashboard)/analytics/coupons/monthly-coupon-report.tsx
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

interface CouponStats {
  id: string;
  month: string;
  couponCode: string;
  redemptions: number;
  totalOrders: number;
  totalDiscount: number;
  revenueAfterDiscount: number;
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

export default function MonthlyCouponReport() {
  const router = useRouter();

  // --- Permissions: couponsReport.view
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { couponsReport: ["view"] }
  );

  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/analytics");
  }, [viewLoading, canView, router]);

  const [data, setData] = useState<CouponStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("currentMonth");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [isCustomDate, setIsCustomDate] = useState(false);

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
    if (preset !== "custom") {
      setDateRange(getDateRangeFromPreset(preset));
    }
  };

  const formatDateRange = () => {
    const { from, to } = dateRange;
    if (datePreset === "today") return "Today";
    if (datePreset === "yesterday") return "Yesterday";
    if (from && to) return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
    return "";
  };

  // --- Fetch guarded by canView
  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");

        const res = await fetch(`/api/report/coupon/?from=${fromDate}&to=${toDate}`);
        if (!res.ok) throw new Error("Failed to load coupon stats");
        const json = await res.json();
        if (!cancelled) setData(json.values.stats);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dateRange, canView]);

  const fmtYearMonth = (iso: string | null): string =>
    iso ? new Date(iso).toISOString().slice(0, 7) : "—";

  const handleCouponSelect = (couponId: string) => {
    router.push(`/analytics/coupons/${couponId}`);
  };

  // Sort by redemptions (highest first)
  const sortedData = [...data].sort((a, b) => b.redemptions - a.redemptions);

  if (viewLoading || !canView) return null; // hide while checking or denied
  if (loading) return <div>Loading report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h1 className="text-3xl font-bold mb-4 md:mb-0">Coupon Performance Report</h1>

        <div className="flex flex-col sm:flex-row gap-4 w-full md:w-auto">
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
          <CardTitle>Coupon Performance: {formatDateRange()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Month</TableHead>
                  <TableHead>Coupon Code</TableHead>
                  <TableHead className="text-right">Redemptions</TableHead>
                  <TableHead className="text-right">% of Orders</TableHead>
                  <TableHead className="text-right">Total Discount</TableHead>
                  <TableHead className="text-right">Revenue After Discount</TableHead>
                  <TableHead className="text-right">Avg Order Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.length > 0 ? (
                  sortedData.map((row) => {
                    const pct = ((row.redemptions / row.totalOrders) * 100).toFixed(1) + "%";
                    const avgAOV = (row.revenueAfterDiscount / row.redemptions).toFixed(2);
                    return (
                      <TableRow
                        key={`${row.month}-${row.couponCode}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleCouponSelect(row.id)}
                      >
                        <TableCell>{fmtYearMonth(row.month)}</TableCell>
                        <TableCell>{row.couponCode}</TableCell>
                        <TableCell className="text-right">{row.redemptions}</TableCell>
                        <TableCell className="text-right">{pct}</TableCell>
                        <TableCell className="text-right">${row.totalDiscount.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${row.revenueAfterDiscount.toFixed(2)}</TableCell>
                        <TableCell className="text-right">${avgAOV}</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-4">
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
          <CardTitle>Coupon Redemptions: {formatDateRange()}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full">
            {data.length > 0 ? (
              <ChartContainer
                className="h-[600px] w-full"
                config={{ redemptions: { label: "Redemptions", color: "hsl(var(--chart-1))" } }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 70 }}>
                    <XAxis
                      dataKey="couponCode"
                      angle={-45}
                      textAnchor="end"
                      height={70}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis label={{ value: "Redemptions", angle: -90, position: "insideLeft" }} />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "rgba(0, 0, 0, 0.1)" }} />
                    <Bar
                      dataKey="redemptions"
                      fill="var(--color-redemptions)"
                      radius={[4, 4, 0, 0]}
                      label={{ position: "top", fill: "var(--foreground)", fontSize: 12 }}
                      onClick={(bar) => handleCouponSelect((bar as any).id)}
                      cursor="pointer"
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No coupon data available for this date range
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
