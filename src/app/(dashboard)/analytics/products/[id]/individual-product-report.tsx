// src/app/(dashboard)/analytics/products/[id]/individual-product-report.tsx
"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";

interface DailyData { date: string; quantity: number; title: string; sku: string; }
interface MonthlyData { month: string; quantity: number; title: string; sku: string; }
interface DateRange { from: Date; to: Date; }
type DatePreset = "currentMonth" | "lastMonth" | "custom";
type ItemKind = "product" | "variation" | "affiliate";

export default function IndividualProductReport() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const search = useSearchParams();

  const onBack = () => router.back();

  // --- Permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } = useHasPermission(
    orgId,
    { productsReport: ["view"] }
  );
  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/analytics/products");
  }, [viewLoading, canView, router]);
  const permsLoading = viewLoading;
  const canShow = !permsLoading && canView;

  // ── Target resolution: read query params with fallback to legacy [id]
  const target = useMemo(() => {
    const kindParam = (search.get("kind") as ItemKind | null) ?? null;
    const qpProductId = search.get("productId");
    const qpVariationId = search.get("variationId");
    const qpAffiliateId = search.get("affiliateProductId");

    // If explicit kind in query → trust it
    if (kindParam === "affiliate" && qpAffiliateId) {
      return { kind: "affiliate" as ItemKind, affiliateProductId: qpAffiliateId };
    }
    if (kindParam === "variation" && qpProductId && qpVariationId) {
      return { kind: "variation" as ItemKind, productId: qpProductId, variationId: qpVariationId };
    }
    if (kindParam === "product" && qpProductId) {
      return { kind: "product" as ItemKind, productId: qpProductId };
    }

    // Legacy fallback: treat /[id] as a simple product id
    const legacyId = params.id;
    return { kind: "product" as ItemKind, productId: String(legacyId) };
  }, [params.id, search]);

  // Helpers to build API URLs (new query-style endpoints),
  // with graceful fallback to legacy path endpoints if needed.
  const buildDailyUrl = (fromISO: string, toISO: string) => {
    const qs = new URLSearchParams({ kind: target.kind, from: fromISO, to: toISO });
    if (target.kind === "affiliate" && target.affiliateProductId) {
      qs.set("affiliateProductId", target.affiliateProductId);
    } else if (target.kind === "variation" && target.productId && target.variationId) {
      qs.set("productId", target.productId);
      qs.set("variationId", target.variationId);
    } else if (target.kind === "product" && target.productId) {
      qs.set("productId", target.productId);
    }
    return `/api/report/product/daily?${qs.toString()}`;
  };

  const buildMonthlyUrl = (year: number) => {
    const qs = new URLSearchParams({ kind: target.kind, year: String(year) });
    if (target.kind === "affiliate" && target.affiliateProductId) {
      qs.set("affiliateProductId", target.affiliateProductId);
    } else if (target.kind === "variation" && target.productId && target.variationId) {
      qs.set("productId", target.productId);
      qs.set("variationId", target.variationId);
    } else if (target.kind === "product" && target.productId) {
      qs.set("productId", target.productId);
    }
    return `/api/report/product/monthly?${qs.toString()}`;
  };

  // Legacy endpoints (used if your backend hasn’t been updated yet)
  const legacyDailyUrl = (fromISO: string, toISO: string) =>
    `/api/report/product/${target.productId}/daily/?from=${fromISO}&to=${toISO}`;
  const legacyMonthlyUrl = (year: number) =>
    `/api/report/product/${target.productId}/monthly/?year=${year}`;

  // ── UI state
  const [dailyData, setDailyData] = useState<DailyData[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("currentMonth");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [isCustomDate, setIsCustomDate] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [title, setTitle] = useState("");
  const [sku, setSku] = useState("");

  const [yearFilter, setYearFilter] = useState<number>(new Date().getFullYear());
  const yearFilterOptions = [new Date().getFullYear(), new Date().getFullYear() - 1, new Date().getFullYear() - 2];

  // Date preset → range
  const getDateRangeFromPreset = (preset: DatePreset): DateRange => {
    const today = new Date();
    switch (preset) {
      case "currentMonth":
        return { from: startOfMonth(today), to: endOfMonth(today) };
      case "lastMonth":
        const last = subMonths(today, 1);
        return { from: startOfMonth(last), to: endOfMonth(last) };
      case "custom":
        const d = new Date(selectedYear, selectedMonth, 1);
        return { from: startOfMonth(d), to: endOfMonth(d) };
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

  const handleCustomDateChange = () => {
    if (datePreset === "custom") {
      const custom = new Date(selectedYear, selectedMonth, 1);
      setDateRange({ from: startOfMonth(custom), to: endOfMonth(custom) });
    }
  };
  useEffect(() => { handleCustomDateChange(); }, [selectedMonth, selectedYear, datePreset]);

  const formatDateRange = () => {
    const { from } = dateRange;
    if (datePreset === "currentMonth") return "Current Month";
    if (datePreset === "lastMonth") return "Last Month";
    if (from) return format(from, "MMMM yyyy");
    return "";
  };

  // ── Fetch Daily (prefers new query-style endpoint; falls back to legacy if needed)
  useEffect(() => {
    if (!canShow) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");

        let url = buildDailyUrl(fromDate, toDate);
        let res = await fetch(url);

        // If server doesn’t support the new endpoint yet, fallback to legacy (simple product only)
        if (!res.ok && target.kind === "product" && target.productId) {
          res = await fetch(legacyDailyUrl(fromDate, toDate));
        }
        if (!res.ok) throw new Error("Failed to load daily report");

        const json = await res.json();
        if (!cancelled) {
          // Expect shape: { daily: DailyData[], title: string, sku: string }
          setDailyData(json.daily ?? []);
          setTitle(json.title ?? "");
          setSku(json.sku ?? "");
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load daily report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target, dateRange, canShow]);

  // ── Fetch Monthly (same fallback approach)
  useEffect(() => {
    if (!canShow) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        let url = buildMonthlyUrl(yearFilter);
        let res = await fetch(url);

        // ⬇️ instead of throwing, allow empty data
        if (!res.ok) {
          setMonthlyData([]);           // <-- show “No monthly data …”
          return;
        }
        if (!res.ok) throw new Error("Failed to load monthly report");

        const json = await res.json();
        if (!cancelled) setMonthlyData(json.monthly ?? []);
      } catch (e: any) {
        if (!cancelled) setError(e.message ?? "Failed to load monthly report");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [target, yearFilter, canShow]);

  // 🔒 Render gates AFTER all hooks have been called
  if (permsLoading) return <div>Loading permissions…</div>;
  if (!canShow) return null;
  if (loading) return <div>Loading product report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!dailyData) return <div>No data available</div>;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center gap-4 mb-6">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-muted-foreground">SKU: {sku}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {target.kind === "variation" && `Variation report`}
            {target.kind === "affiliate" && `Affiliate product report`}
            {target.kind === "product" && `Simple product report`}
          </p>
        </div>
      </div>

      {/* Daily Report */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Daily Sales: {formatDateRange()}</CardTitle>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={datePreset} onValueChange={handleDatePresetChange}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="currentMonth">Current month</SelectItem>
                  <SelectItem value="lastMonth">Last month</SelectItem>
                  <SelectItem value="custom">Custom month</SelectItem>
                </SelectContent>
              </Select>

              {isCustomDate && (
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full sm:w-[160px] justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(new Date(selectedYear, selectedMonth), "MMM yyyy")}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">Month</label>
                        <Select value={selectedMonth.toString()} onValueChange={(v) => setSelectedMonth(Number.parseInt(v))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map(
                              (m, i) => <SelectItem key={i} value={i.toString()}>{m}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">Year</label>
                        <Select value={selectedYear.toString()} onValueChange={(v) => setSelectedYear(Number.parseInt(v))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {yearFilterOptions.map(
                              (y) => <SelectItem key={y} value={y.toString()}>{y}</SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full">
            {dailyData ? (
              <ChartContainer className="h-[400px] w-full" config={{ quantity: { label: "Quantity", color: "hsl(var(--chart-1))" } }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dailyData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) => format(new Date(v + "T00:00:00"), "MMM d")}
                      interval={0}
                      angle={-45}
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis tick={{ fontSize: 12 }} label={{ value: "Quantity", angle: -90, position: "insideLeft" }} />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "rgba(0, 0, 0, 0.1)" }} />
                    <Bar dataKey="quantity" fill="var(--color-quantity)" radius={[4, 4, 0, 0]} name="Quantity Sold" label={{ position: "top", fill: "var(--foreground)", fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No daily data available for this period
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Monthly Report */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Monthly Sales Trend</CardTitle>
            <Select value={yearFilter.toString()} onValueChange={(v) => setYearFilter(Number.parseInt(v))}>
              <SelectTrigger className="w-full sm:w-[120px]">
                <SelectValue placeholder="Select year" />
              </SelectTrigger>
              <SelectContent>
                {yearFilterOptions.map((year) => (
                  <SelectItem key={year} value={year.toString()}>
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-[400px] w-full">
            {monthlyData && monthlyData.length > 0 ? (
              <ChartContainer className="h-[400px] w-full" config={{ quantity: { label: "Quantity", color: "hsl(var(--chart-2))" } }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyData} margin={{ top: 20, right: 30, left: 20, bottom: 50 }}>
                    <XAxis
                      dataKey="month"
                      angle={-45}
                      textAnchor="end"
                      height={70}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(val: string) => {
                        const [year, month] = val.split("-").map(Number);
                        const date = new Date(year, month - 1, 1);
                        return format(date, "MMM yyyy");
                      }}
                    />
                    <YAxis tick={{ fontSize: 12 }} label={{ value: "Quantity", angle: -90, position: "insideLeft" }} />
                    <ChartTooltip content={<ChartTooltipContent />} cursor={{ fill: "rgba(0, 0, 0, 0.1)" }} />
                    <Bar dataKey="quantity" fill="var(--color-quantity)" radius={[4, 4, 0, 0]} name="Quantity Sold" label={{ position: "top", fill: "var(--foreground)", fontSize: 12 }} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                No monthly data available for {yearFilter}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
