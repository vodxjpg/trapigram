// Supplier Payables – shows how much you owe each immediate supplier (transfer price × qty)
"use client";

import Link from "next/link";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
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
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
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
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// React Select + flags (same as revenue page)
import ReactSelect from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
countriesLib.registerLocale(enLocale);

type Line = {
  orderId: string;
  orderNumber: string;
  datePaid: string;
  username: string;
  country: string;
  cancelled: boolean;
  refunded: boolean;
  supplierOrgId: string | null;
  supplierLabel: string | null;
  productTitle: string;
  quantity: number;
  unitCost: number; // in selected currency
  lineTotal: number; // in selected currency
};

type CustomDateRange = { from: Date; to: Date };

const chartConfig = {
  owed: { label: "Owed", color: "var(--color-mobile)" },
} satisfies ChartConfig;

const ALL_SUPPLIERS = "__ALL__";

type DatePreset =
  | "all" | "today" | "yesterday"
  | "this-week" | "last-week"
  | "this-month" | "last-month"
  | "this-year" | "last-year"
  | "custom";

function getPresetRange(preset: DatePreset): { from: Date; to: Date } {
  const now = new Date();
  switch (preset) {
    case "today": return { from: startOfDay(now), to: endOfDay(now) };
    case "yesterday": {
      const y = subDays(now, 1);
      return { from: startOfDay(y), to: endOfDay(y) };
    }
    case "this-week": return { from: startOfWeek(now), to: endOfWeek(now) };
    case "last-week": {
      const lw = subWeeks(now, 1);
      return { from: startOfWeek(lw), to: endOfWeek(lw) };
    }
    case "this-month": return { from: startOfMonth(now), to: endOfMonth(now) };
    case "last-month": {
      const lm = subMonths(now, 1);
      return { from: startOfMonth(lm), to: endOfMonth(lm) };
    }
    case "this-year": return { from: startOfYear(now), to: endOfYear(now) };
    case "last-year": {
      const ly = subYears(now, 1);
      return { from: startOfYear(ly), to: endOfYear(ly) };
    }
    case "all": return { from: new Date(0), to: endOfDay(new Date(2099, 11, 31)) };
    case "custom":
    default: return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
  }
}

export default function SupplierPayables() {
  const router = useRouter();

  // permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canView, isLoading: viewLoading } =
    useHasPermission(orgId, { revenue: ["view"] }); // reuse same permission gate
  const { hasPermission: canExport, isLoading: exportLoading } =
    useHasPermission(orgId, { revenue: ["export"] });

  useEffect(() => {
    if (!viewLoading && !canView) router.replace("/analytics");
  }, [viewLoading, canView, router]);

  const permsLoading = viewLoading || exportLoading;
  const canShow = !permsLoading && canView;

  // date preset + custom
  const [datePreset, setDatePreset] = useState<DatePreset>("last-month");
  const [dateRange, setDateRange] = useState<CustomDateRange>(getPresetRange("last-month"));
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>({
    from: dateRange.from,
    to: dateRange.to,
  });

  // table / filters
  const [currentPage, setCurrentPage] = useState(1);
  const [currency, setCurrency] = useState<"USD" | "GBP" | "EUR">("USD");
  const [status, setStatus] = useState<"all" | "paid" | "refunded" | "cancelled">("all");

  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // countries from API + selected (multi)
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  // supplier filter (orgId) + options from API
  const [supplierOrgId, setSupplierOrgId] = useState<string>("");
  const [supplierOptions, setSupplierOptions] = useState<Array<{ orgId: string; label: string }>>([]);

  const [chartData, setChartData] = useState<{ date: string; owed: number }[]>([]);
  const isMobile = useIsMobile();

  const rowsPerPage = 25;

  function handleDatePreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset === "custom") {
      setTempDateRange({ from: dateRange.from, to: dateRange.to });
      setCustomDateOpen(true);
      return;
    }
    setDateRange(getPresetRange(preset));
  }

  const handleCustomDateApply = () => {
    if (tempDateRange?.from && tempDateRange?.to) {
      setDateRange({
        from: startOfDay(tempDateRange.from),
        to: endOfDay(tempDateRange.to),
      });
      setDatePreset("custom");
      setCustomDateOpen(false);
    }
  };

  const handleCustomDateCancel = () => {
    setTempDateRange({ from: dateRange.from, to: dateRange.to });
    setCustomDateOpen(false);
  };

  // fetch data
  useEffect(() => {
    async function fetchData() {
      if (!canShow) return;
      setLoading(true);
      setError(null);
      try {
        const from = encodeURIComponent(dateRange.from.toISOString());
        const to = encodeURIComponent(dateRange.to.toISOString());
        const supParam = supplierOrgId ? `&supplierOrgId=${encodeURIComponent(supplierOrgId)}` : "";
        const res = await fetch(
          `/api/report/suppliers?from=${from}&to=${to}&currency=${currency}&status=${status}${supParam}`
        );
        if (!res.ok) throw new Error(`API error: ${res.status}`);
        const data = await res.json();
        setLines(data.lines);
        setChartData(data.chartData);
        setCountries(Array.isArray(data.countries) ? [...data.countries].sort() : []);
        setSupplierOptions(Array.isArray(data.suppliers) ? data.suppliers : []);
        setCurrentPage(1);
      } catch (err: any) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [dateRange, currency, status, supplierOrgId, canShow]);

  const countryOptions = useMemo(
    () => countries.map((c) => ({ value: c, label: countriesLib.getName(c, "en") || c })),
    [countries]
  );

  const filteredLines = useMemo(() => {
    const byCountry = (l: Line) =>
      selectedCountries.length === 0 ? true : selectedCountries.includes(l.country);
    const list = lines.filter(byCountry);
    return list.sort((a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime());
  }, [lines, selectedCountries]);

  const totalPages = Math.ceil(filteredLines.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentRows = filteredLines.slice(startIndex, endIndex);

  const fmtMoney = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);

  const renderCountriesSummary = () => {
    if (selectedCountries.length === 0) return "All countries";
    if (selectedCountries.length <= 3) return selectedCountries.join(", ");
    return `${selectedCountries.length} selected`;
  };

  const exportToExcel = () => {
    if (!canExport) return;
    const dataForSheet = filteredLines.map((l) => ({
      "Paid At": format(new Date(l.datePaid), "yyyy-MM-dd HH:mm"),
      "Order Number": l.orderNumber,
      Status: l.cancelled ? "Cancelled" : l.refunded ? "Refunded" : "Paid",
      Username: l.username,
      Supplier: l.supplierLabel ?? "",
      Product: l.productTitle,
      Qty: l.quantity,
      "Unit Cost": l.unitCost,
      "Line Total": l.lineTotal,
      Country: l.country,
    }));
    const ws = XLSX.utils.json_to_sheet(dataForSheet);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Payables");
    const wbout = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    const blob = new Blob([wbout], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `supplier-payables_${format(new Date(), "yyyyMMdd_HHmm")}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (permsLoading) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (!canShow) return null;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Supplier Payables</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Top Controls Row */}
            <div className="flex flex-col sm:flex-row gap-4 mb-2 items-start sm:items-center justify-between">
              {/* Left: date preset dropdown + (custom picker) */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Date</span>
                <Select value={datePreset} onValueChange={(v) => handleDatePreset(v as DatePreset)}>
                  <SelectTrigger size="sm" className="min-w-[200px]">
                    <SelectValue placeholder="Select range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="today">Today</SelectItem>
                    <SelectItem value="yesterday">Yesterday</SelectItem>
                    <SelectItem value="this-week">This week</SelectItem>
                    <SelectItem value="last-week">Last week</SelectItem>
                    <SelectItem value="this-month">This month</SelectItem>
                    <SelectItem value="last-month">Last month</SelectItem>
                    <SelectItem value="this-year">This year</SelectItem>
                    <SelectItem value="last-year">Last year</SelectItem>
                    <SelectItem value="custom">Custom…</SelectItem>
                  </SelectContent>
                </Select>

                {datePreset !== "custom" && (
                  <div className="text-xs text-muted-foreground">
                    {format(dateRange.from, "MMM dd, yyyy")} – {format(dateRange.to, "MMM dd, yyyy")}
                  </div>
                )}

                {datePreset === "custom" && (
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
                              ? `${format(tempDateRange.from, "MMM dd, yyyy")} - ${format(
                                  tempDateRange.to,
                                  "MMM dd, yyyy",
                                )}`
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
                )}
              </div>

              {/* Right: currency, status, export */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Currency</span>
                <Select value={currency} onValueChange={(v) => setCurrency(v as "USD"|"GBP"|"EUR")} className="w-24">
                  <SelectTrigger size="sm">
                    <SelectValue placeholder="Currency" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>

                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Select
                    value={status}
                    onValueChange={(v) => setStatus(v as "all" | "paid" | "cancelled" | "refunded")}
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
                  disabled={!canExport}
                  title={canExport ? "Export to Excel" : "You lack export permission"}
                >
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Export to Excel
                </Button>
              </div>

              {/* Supplier filter */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Supplier</span>
                <Select
                  value={supplierOrgId ? supplierOrgId : ALL_SUPPLIERS}
                  onValueChange={(v) => setSupplierOrgId(v === ALL_SUPPLIERS ? "" : v)}
                >
                  <SelectTrigger size="sm" className="min-w-[220px]">
                    <SelectValue placeholder="All suppliers" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem key="__all" value={ALL_SUPPLIERS}>All suppliers</SelectItem>
                    {supplierOptions.map((s) => (
                      <SelectItem key={s.orgId} value={s.orgId}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Countries multi-select */}
            <div className="mb-6">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium">Countries</span>
                {selectedCountries.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {selectedCountries.length <= 3
                      ? selectedCountries.join(", ")
                      : `${selectedCountries.length} selected`}
                  </span>
                )}
              </div>
              <div className="w-full sm:w-[640px]">
                <ReactSelect
                  isMulti
                  classNamePrefix="rs"
                  options={countryOptions}
                  placeholder="Select country(s)"
                  value={countryOptions.filter((o) => selectedCountries.includes(o.value))}
                  onChange={(opts: any) =>
                    setSelectedCountries(Array.isArray(opts) ? opts.map((o: any) => o.value) : [])
                  }
                  formatOptionLabel={(o: any) => (
                    <div className="flex items-center gap-2">
                      <ReactCountryFlag countryCode={o.value} svg style={{ width: 20 }} />
                      <span>{o.label}</span>
                    </div>
                  )}
                />
              </div>
            </div>

            {/* Table */}
            {loading && <div>Loading payables…</div>}
            {error && <div className="text-red-600">Error: {error}</div>}
            {!loading && !error && (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {filteredLines.length} lines from{" "}
                  {format(dateRange.from, "MMM dd, yyyy")} to{" "}
                  {format(dateRange.to, "MMM dd, yyyy")}
                  {selectedCountries.length > 0 ? ` in ${renderCountriesSummary()}` : ""}
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {[
                          "Paid At",
                          "Order",
                          "Status",
                          "Username",
                          "Supplier",
                          "Product",
                          "Qty",
                          "Unit Cost",
                          "Line Total",
                          "Country",
                        ].map((h) => (
                          <TableHead
                            key={h}
                            className={
                              ["Qty", "Unit Cost", "Line Total"].includes(h)
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
                      {currentRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                            No payables found for the selected filters.
                          </TableCell>
                        </TableRow>
                      ) : (
                        currentRows.map((l, idx) => (
                          <TableRow key={`${l.orderId}-${idx}`}>
                            <TableCell>{format(new Date(l.datePaid), "MMM dd, yyyy HH:mm")}</TableCell>
                            <TableCell className="font-medium">{l.orderNumber}</TableCell>
                            <TableCell>
                              {l.cancelled ? "Cancelled" : l.refunded ? "Refunded" : "Paid"}
                            </TableCell>
                            <TableCell>
                              <Link href={`/clients/${l.orderId}/info`}>
                                {l.username}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-[280px]">
                              {l.supplierLabel ?? "—"}
                            </TableCell>
                            <TableCell className="max-w-[480px]">{l.productTitle}</TableCell>
                            <TableCell className="text-right">{l.quantity}</TableCell>
                            <TableCell className="text-right">{fmtMoney(l.unitCost)}</TableCell>
                            <TableCell className="text-right font-medium">{fmtMoney(l.lineTotal)}</TableCell>
                            <TableCell>{l.country}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, filteredLines.length)} of {filteredLines.length} lines
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

      {/* Chart */}
      <div className="px-4 lg:px-6">
        <Card className="@container/card">
          <CardHeader>
            <CardTitle>Amount Owed (Daily)</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
            <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
              <AreaChart data={chartData} margin={{ top: 20, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="fillOwed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-mobile)" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="var(--color-mobile)" stopOpacity={0.1} />
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
                    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                  }}
                />
                <ChartTooltip
                  cursor={false}
                  defaultIndex={isMobile ? -1 : 10}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(value) => {
                        const dt = new Date(`${value}T00:00:00`);
                        return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
                      }}
                      indicator="dot"
                    />
                  }
                />
                <Area
                  dataKey="owed"
                  type="natural"
                  fill="url(#fillOwed)"
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
