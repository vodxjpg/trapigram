// src/app/(dashboard)/report/order-report.tsx
// OrderReport page – full file with Countries moved to a new row under Currency/Status/Export
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
  Check,
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
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

// React Select + flags to match Coupon view
import ReactSelect from "react-select";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";
countriesLib.registerLocale(enLocale);

type Order = {
  id: string;
  datePaid: string;
  orderNumber: string;
  cancelled: boolean;
  refunded: boolean;
  status?: "paid" | "pending_payment" | "refunded" | "cancelled" | "open" | "partially_paid";
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
  dropshipperOrgId?: string | null;
  dropshipperLabel?: string | null;
};

type Totals = {
  currency: "USD" | "GBP" | "EUR";
  all: {
    totalPrice: number;
    shippingCost: number;
    discount: number;
    cost: number;
    netProfit: number;
  };
  paid: {
    totalPrice: number;
    shippingCost: number;
    discount: number;
    cost: number;
    revenue: number;
  };
};

type CustomDateRange = { from: Date; to: Date };

const chartConfig = {
  total: { label: "Total", color: "var(--color-desktop)" },
  revenue: { label: "Revenue", color: "var(--color-mobile)" },
} satisfies ChartConfig;

export default function OrderReport() {
  const router = useRouter();

  // permissions
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;
  const { hasPermission: canViewRevenue, isLoading: viewLoading } =
    useHasPermission(orgId, { revenue: ["view"] });
  const { hasPermission: canExportRevenue, isLoading: exportLoading } =
    useHasPermission(orgId, { revenue: ["export"] });

  useEffect(() => {
    if (!viewLoading && !canViewRevenue) router.replace("/analytics");
  }, [viewLoading, canViewRevenue, router]);

  const permsLoading = viewLoading || exportLoading;
  const canShow = !permsLoading && canViewRevenue;

  // ─────────────────────────────────────────────────────────────
  // Date preset handling (dropdown + custom popover)
  // ─────────────────────────────────────────────────────────────
  type DatePreset =
    | "all"
    | "today"
    | "yesterday"
    | "this-week"
    | "last-week"
    | "this-month"
    | "last-month"
    | "this-year"
    | "last-year"
    | "custom";

  function getPresetRange(preset: DatePreset): { from: Date; to: Date } {
    const now = new Date();
    switch (preset) {
      case "today":
        return { from: startOfDay(now), to: endOfDay(now) };
      case "yesterday": {
        const y = subDays(now, 1);
        return { from: startOfDay(y), to: endOfDay(y) };
      }
      case "this-week":
        return { from: startOfWeek(now), to: endOfWeek(now) };
      case "last-week": {
        const lw = subWeeks(now, 1);
        return { from: startOfWeek(lw), to: endOfWeek(lw) };
      }
      case "this-month":
        return { from: startOfMonth(now), to: endOfMonth(now) };
      case "last-month":
        return { from: startOfMonth(subMonths(now, 1)), to: endOfMonth(subMonths(now, 1)) };
      case "this-year":
        return { from: startOfYear(now), to: endOfYear(now) };
      case "last-year":
        return { from: startOfYear(subYears(now, 1)), to: endOfYear(subYears(now, 1)) };
      case "all":
        return { from: new Date(0), to: endOfDay(new Date(2099, 11, 31)) };
      case "custom":
      default:
        return { from: startOfDay(subDays(now, 30)), to: endOfDay(now) };
    }
  }

  const [datePreset, setDatePreset] = useState<DatePreset>("last-month");

  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState<CustomDateRange>(
    getPresetRange("last-month")
  );
  const [customDateOpen, setCustomDateOpen] = useState(false);
  const [tempDateRange, setTempDateRange] = useState<DateRange | undefined>({
    from: dateRange.from,
    to: dateRange.to,
  });

  const [currency, setCurrency] = useState<"USD" | "GBP" | "EUR">("USD");

  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<
    "all" | "paid" | "refunded" | "cancelled" | "pending_payment"
  >("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // countries from API + selected (multi)
  const [countries, setCountries] = useState<string[]>([]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);

  // Seller filter: retailers (no dropshipper) vs dropshippers (one or many suppliers)
  const [sellerFilter, setSellerFilter] = useState<"retailers" | "dropshippers">("retailers");
  const [selectedDropshippers, setSelectedDropshippers] = useState<string[]>([]);
  const [dsPopoverOpen, setDsPopoverOpen] = useState(false);
  const [dropshipperOptions, setDropshipperOptions] = useState<
    Array<{ orgId: string; label: string }>
  >([]);

  const [totals, setTotals] = useState<Totals | null>(null);

  const [chartData, setChartData] = useState<
    { date: string; total: number; revenue: number }[]
  >([]);
  const isMobile = useIsMobile();

  const rowsPerPage = 25;

  // fetch data (no country/dropshipper param; filtering is client-side)
  useEffect(() => {
    async function fetchOrders() {
      if (!canShow) return;
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
        setOrders(data.orders);
        setChartData(data.chartData);
        setTotals(data.totals ?? null);
        setCountries(
          Array.isArray(data.countries) ? [...data.countries].sort() : []
        );
        setDropshipperOptions(
          Array.isArray(data.dropshippers) ? data.dropshippers : []
        );
        setCurrentPage(1);
      } catch (err: any) {
        setError(err.message || "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchOrders();
  }, [dateRange, currency, status, canShow]);

  const countryOptions = useMemo(
    () =>
      countries.map((c) => ({
        value: c,
        label: countriesLib.getName(c, "en") || c,
      })),
    [countries]
  );
  const SELECT_ALL = "__ALL__";
  const DESELECT_ALL = "__NONE__";

  const selectOptions = useMemo(
    () => [
      { value: SELECT_ALL, label: "SELECT ALL" },
      { value: DESELECT_ALL, label: "DESELECT ALL" },
      ...countryOptions,
    ],
    [countryOptions]
  );
  const filteredData = chartData;

  const dropshipperSummary = useMemo(() => {
    if (sellerFilter === "retailers") return "Retailers";
    if (selectedDropshippers.length === 0) return "All dropshippers";
    const labels = dropshipperOptions
      .filter((d) => selectedDropshippers.includes(d.orgId))
      .map((d) => d.label);
    return labels.length <= 2 ? labels.join(", ") : `${labels.length} selected`;
  }, [sellerFilter, selectedDropshippers, dropshipperOptions]);

  const filteredOrders = useMemo(() => {
    const matchesStatus = (o: Order) => {
      switch (status) {
        case "paid":
          return o.status ? o.status === "paid" : (!o.cancelled && !o.refunded);
        case "pending_payment":
          return o.status === "pending_payment";
        case "cancelled":
          return o.cancelled === true;
        case "refunded":
          return o.refunded === true;
        case "all":
        default:
          return true;
      }
    };
    const matchesCountries = (o: Order) =>
      selectedCountries.length === 0
        ? true
        : selectedCountries.includes(o.country);

    const matchesSeller = (o: Order) => {
      const ds = o.dropshipperOrgId ?? null;
      if (sellerFilter === "retailers") {
        return !ds; // show orders that don't come from a dropshipper
      }
      // dropshippers
      if (!ds) return false;
      // If none selected, show all dropshipper orders
      if (selectedDropshippers.length === 0) return true;
      return selectedDropshippers.includes(ds);
    };

    const list = orders.filter(
      (o) => matchesStatus(o) && matchesCountries(o) && matchesSeller(o)
    );
    return list.sort(
      (a, b) => new Date(b.datePaid).getTime() - new Date(a.datePaid).getTime()
    );
  }, [orders, status, selectedCountries, sellerFilter, selectedDropshippers]);

  const totalPages = Math.ceil(filteredOrders.length / rowsPerPage);
  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const currentOrders = filteredOrders.slice(startIndex, endIndex);

  // ⬇️ keep this inside the component so it "sees" the `currency` state
  const fmtMoney = (amount: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
      Number(amount || 0)
    );

  function handleDatePreset(preset: DatePreset) {
    setDatePreset(preset);
    if (preset === "custom") {
      setTempDateRange({ from: dateRange.from, to: dateRange.to });
      setCustomDateOpen(true);
      return;
    }
    const range = getPresetRange(preset);
    setDateRange(range);
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

  const renderCountriesSummary = () => {
    if (selectedCountries.length === 0) return "All countries";
    if (selectedCountries.length <= 3) return selectedCountries.join(", ");
    return `${selectedCountries.length} selected`;
  };

  const exportToExcel = () => {
    if (!canExportRevenue) return;

    const dataForSheet = filteredOrders.map((o) => {
      let netProfitDisplay;
      if (o.cancelled === true) {
        netProfitDisplay = 0;
      } else if (o.refunded === true) {
        netProfitDisplay = -Math.abs(Number(o.netProfit) || 0);
      } else {
        netProfitDisplay = o.netProfit;
      }
      const rowStatus =
        o.cancelled === true
          ? "Cancelled"
          : o.refunded === true
          ? "Refunded"
          : o.status === "pending_payment"
          ? "Pending Payment"
          : "Paid";
      return {
        "Paid At": format(new Date(o.datePaid), "yyyy-MM-dd HH:mm"),
        "Order Number": o.orderNumber,
        Status: rowStatus,
        "User ID": o.userId,
        Country: o.country,
        Dropshipper: o.dropshipperLabel ?? "",
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

  if (permsLoading) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6 text-sm text-muted-foreground">
          Loading…
        </div>
      </div>
    );
  }
  if (!canShow) return null;

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <Card>
          <CardHeader>
            <CardTitle>Order Report</CardTitle>
          </CardHeader>
          <CardContent>
                  {/* Top Controls: responsive grid so mobile doesn't look squished */}
       <div className="grid gap-3 mb-3 items-start sm:grid-cols-2 lg:grid-cols-3">
         {/* Date preset + (custom picker) */}
         <div className="flex flex-wrap items-center gap-2 w-full">
                <span className="text-sm font-medium">Date</span>
                <Select
                  value={datePreset}
                  onValueChange={(v) => handleDatePreset(v as DatePreset)}
                >
                  <SelectTrigger size="sm" className="w-full sm:w-[200px]">
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
                {/* Show the currently active range for non-custom presets */}
                {datePreset !== "custom" && (
                  <div className="text-xs text-muted-foreground">
                    {format(dateRange.from, "MMM dd, yyyy")} –{" "}
                    {format(dateRange.to, "MMM dd, yyyy")}
                  </div>
                )}
                {/* When "custom" is selected, show the date picker popover */}
                {datePreset === "custom" && (
                  <Popover
                    open={customDateOpen}
                    onOpenChange={setCustomDateOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                      variant="outline"
                       size="sm"
                       className="justify-start text-left w-full sm:min-w-[240px] bg-transparent"
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
                                  "MMM dd, yyyy"
                                )}`
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
                )}
              </div>

              {/* Right: currency, status, export */}
              <div className="flex flex-wrap items-center gap-2 w-full sm:justify-end">
                <span className="text-sm font-medium">Currency</span>
                <Select
                  value={currency}
                  onValueChange={(v) => setCurrency(v as "USD" | "GBP" | "EUR")}
                  className="w-full sm:w-24"
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

                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">Status</span>
                  <Select
                    value={status}
                    onValueChange={(v) =>
                      setStatus(v as "all" | "paid" | "cancelled" | "refunded" | "pending_payment")
                    }
                    className="w-full sm:w-32"
                  >
                    <SelectTrigger size="sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="pending_payment">Pending Payment</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  variant="default"
                  size="sm"
                  className="shrink-0 w-full sm:w-auto"
                  onClick={exportToExcel}
                  disabled={!canExportRevenue}
                  title={
                    canExportRevenue
                      ? "Export to Excel"
                      : "You lack export permission"
                  }
                >
                  <DownloadIcon className="mr-2 h-4 w-4" />
                  Export to Excel
                </Button>
              </div>

              {/* Seller filter: Retailers or Dropshippers (dropdown + dropdown) */}
              <div className="flex flex-wrap items-center gap-2 w-full">
                <span className="text-sm font-medium">Filter by</span>
                <Select
                  value={sellerFilter}
                  onValueChange={(v) =>
                    setSellerFilter(v as "retailers" | "dropshippers")
                  }
                >
                  <SelectTrigger size="sm" className="w-full sm:w-[160px]">
                    <SelectValue placeholder="Seller type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="retailers">Retailers</SelectItem>
                    <SelectItem value="dropshippers">Dropshipper</SelectItem>
                  </SelectContent>
                </Select>

                {sellerFilter === "dropshippers" && (
                  <Popover open={dsPopoverOpen} onOpenChange={setDsPopoverOpen}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start w-full sm:w-[220px]"
                        aria-haspopup="listbox"
                        aria-expanded={dsPopoverOpen}
                      >
                        {dropshipperSummary}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="p-0 w-[260px] sm:w-[340px]" align="start">
                      <Command>
                        <div className="px-3 pt-3">
                          <CommandInput placeholder="Search dropshipper..." />
                        </div>
                        <CommandList>
                          <CommandEmpty>No Dropshipper found.</CommandEmpty>
                          <CommandGroup heading="Dropshippers">
                            {dropshipperOptions.map((d) => {
                              const checked = selectedDropshippers.includes(d.orgId);
                              return (
                                <CommandItem
                                  key={d.orgId}
                                  value={d.label}
                                  onSelect={() => {
                                    setSelectedDropshippers((prev) =>
                                      prev.includes(d.orgId)
                                        ? prev.filter((x) => x !== d.orgId)
                                        : [...prev, d.orgId]
                                    );
                                  }}
                                  className="flex items-center"
                                >
                                  <Check
                                    className={`mr-2 h-4 w-4 ${
                                      checked ? "opacity-100" : "opacity-0"
                                    }`}
                                  />
                                  <span>{d.label}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                          <CommandSeparator />
                          <div className="flex items-center justify-between gap-2 p-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                setSelectedDropshippers(
                                  dropshipperOptions.map((d) => d.orgId)
                                )
                              }
                            >
                              Select all
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedDropshippers([])}
                            >
                              Deselect all
                            </Button>
                          </div>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                )}
              </div>
            </div>

            {/* New Row: Countries multi-select (matches Coupon styling) */}
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
                  closeMenuOnSelect={false}
                  hideSelectedOptions={false}
                  classNamePrefix="rs"
                  options={selectOptions}
                  placeholder="Select country(s)"
                  value={countryOptions.filter((o) =>
                    selectedCountries.includes(o.value)
                  )}
                  onChange={(opts: any, actionMeta: any) => {
                    const clicked = actionMeta?.option as
                      | { value: string }
                      | undefined;

                    // Handle special options
                    if (actionMeta?.action === "select-option" && clicked) {
                      if (clicked.value === SELECT_ALL) {
                        setSelectedCountries(countries); // all available from API
                        return;
                      }
                      if (clicked.value === DESELECT_ALL) {
                        setSelectedCountries([]);
                        return;
                      }
                    }

                    // Normal multi-select behavior
                    const next = Array.isArray(opts) ? opts : [];
                    setSelectedCountries(
                      next
                        .filter(
                          (o) =>
                            o.value !== SELECT_ALL && o.value !== DESELECT_ALL
                        )
                        .map((o) => o.value)
                    );
                  }}
                  formatOptionLabel={(o: any) =>
                    o.value === SELECT_ALL || o.value === DESELECT_ALL ? (
                      <div className="text-xs font-medium">{o.label}</div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <ReactCountryFlag
                          countryCode={o.value}
                          svg
                          style={{ width: 20 }}
                        />
                        <span>{o.label}</span>
                      </div>
                    )
                  }
                />
              </div>
            </div>
            {totals && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {/* Paid (chart-aligned) */}
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    Paid Total (Gross)
                  </div>
                  <div className="text-xl font-semibold">
                    {fmtMoney(totals.paid.totalPrice)}
                  </div>
                </div>
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    Paid Revenue
                  </div>
                  <div className="text-xl font-semibold">
                    {fmtMoney(totals.paid.revenue)}
                  </div>
                </div>

                {/* All orders (includes cancelled/refunded) */}
                <div className="rounded-md border p-4">
                  <div className="text-xs text-muted-foreground">
                    All Orders Total
                  </div>
                  <div className="text-xl font-semibold">
                    {fmtMoney(totals.all.totalPrice)}
                  </div>
                </div>
              </div>
            )}

            {/* Status / Table */}
            {loading && <div>Loading orders…</div>}
            {error && <div className="text-red-600">Error: {error}</div>}
            {!loading && !error && (
              <>
                <div className="mb-4 text-sm text-muted-foreground">
                  Showing {filteredOrders.length} orders from{" "}
                  {format(dateRange.from, "MMM dd, yyyy")} to{" "}
                  {format(dateRange.to, "MMM dd, yyyy")}
                  {selectedCountries.length > 0
                    ? ` in ${renderCountriesSummary()}`
                    : ""}
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
                          "Dropshipper",
                          "Country",
                          `Total Price (${currency})`,
                          `Shipping Cost (${currency})`,
                          `Discount (${currency})`,
                          `Cost (${currency})`,
                          "Asset",
                          `Net Profit (${currency})`,
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
                              {o.cancelled
                                ? "Cancelled"
                                : o.refunded
                                ? "Refunded"
                                : o.status === "pending_payment"
                                ? "Pending Payment"
                                : "Paid"}
                            </TableCell>
                            <TableCell>
                              <Link href={`/clients/${o.userId || o.id}/info`}>
                                {o.username || o.userId}
                              </Link>
                            </TableCell>

                            <TableCell className="max-w-[280px]">
                              {o.dropshipperLabel ?? "—"}
                            </TableCell>

                            <TableCell>{o.country}</TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled === true || o.refunded === true
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {fmtMoney(o.totalPrice)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled === true || o.refunded === true
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {fmtMoney(o.shippingCost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled === true || o.refunded === true
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {fmtMoney(o.discount)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled === true || o.refunded === true
                                  ? "text-red-600"
                                  : ""
                              }`}
                            >
                              {fmtMoney(o.cost)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                o.cancelled === true || o.refunded === true
                                  ? "text-red-600"
                                  : ""
                              }`}
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
                              {o.cancelled
                                ? fmtMoney(0)
                                : fmtMoney(o.netProfit)}
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
                      valueFormatter={(v) => fmtMoney(Number(v))}
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
