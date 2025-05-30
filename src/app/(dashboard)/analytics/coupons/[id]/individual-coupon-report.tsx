"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/card";
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
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import { CalendarIcon, ArrowLeft } from "lucide-react";

interface DailyData {
  date: string; // e.g. "2025-01"
  quantity: number;
  title: string;
  sku: string;
}

interface MonthlyData {
  month: string; // e.g. "2025-01"
  quantity: number;
  title: string;
  sku: string;
}

interface DateRange {
  from: Date;
  to: Date;
}

type DatePreset = "currentMonth" | "lastMonth" | "custom";

export default function IndividualCouponReport() {
  const router = useRouter();
  const params = useParams();
  const couponId = params.id;
  const onBack = () => router.back();
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
  const [code, setCode] = useState("");

  const [yearFilter, setYearFilter] = useState<number>(
    new Date().getFullYear()
  );
  const yearFilterOptions = [2025, 2026, 2027];

  // Generate date range based on preset
  const getDateRangeFromPreset = (preset: DatePreset): DateRange => {
    const today = new Date();

    switch (preset) {
      case "currentMonth":
        return {
          from: startOfMonth(today),
          to: endOfMonth(today),
        };
      case "lastMonth":
        const lastMonth = subMonths(today, 1);
        return {
          from: startOfMonth(lastMonth),
          to: endOfMonth(lastMonth),
        };
      case "custom":
        const customDate = new Date(selectedYear, selectedMonth, 1);
        return {
          from: startOfMonth(customDate),
          to: endOfMonth(customDate),
        };
      default:
        return {
          from: startOfMonth(today),
          to: endOfMonth(today),
        };
    }
  };

  // Handle date preset change
  const handleDatePresetChange = (value: string) => {
    const preset = value as DatePreset;
    setDatePreset(preset);
    setIsCustomDate(preset === "custom");

    if (preset !== "custom") {
      const newDateRange = getDateRangeFromPreset(preset);
      setDateRange(newDateRange);
    }
  };

  // Handle custom month/year change
  const handleCustomDateChange = () => {
    if (datePreset === "custom") {
      const customDate = new Date(selectedYear, selectedMonth, 1);
      setDateRange({
        from: startOfMonth(customDate),
        to: endOfMonth(customDate),
      });
    }
  };

  useEffect(() => {
    handleCustomDateChange();
  }, [selectedMonth, selectedYear, datePreset]);

  // Format date range for display
  const formatDateRange = () => {
    const { from } = dateRange;

    if (datePreset === "currentMonth") {
      return "Current Month";
    } else if (datePreset === "lastMonth") {
      return "Last Month";
    } else if (from) {
      return format(from, "MMMM yyyy");
    }
    return "";
  };

  // --- fetch the daily from/to report
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");
        const res = await fetch(
          `/api/report/coupon/${couponId}/daily/?from=${fromDate}&to=${toDate}`
        );
        if (!res.ok) throw new Error("Failed to load daily report");
        const json = await res.json();
        if (!cancelled) {
          setDailyData(json.daily);
          setCode(json.code);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [couponId, dateRange]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/report/coupon/${couponId}/monthly/?year=${yearFilter}`
        );
        if (!res.ok) throw new Error("Failed to load monthly report");
        const json = await res.json();
        if (!cancelled) {
          setMonthlyData(json.monthly);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [couponId, yearFilter]);
  console.log(monthlyData);

  // Generate month options (current year and previous year)
  const monthOptions = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  // Generate year options (current year and 2 previous years)
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear, currentYear - 1, currentYear - 2];

  if (loading) return <div>Loading product report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;
  if (!dailyData) return <div>No data available</div>;

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center gap-4 mb-6">
        {onBack && (
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        )}
        <div>
          <h1 className="text-3xl font-bold">{code}</h1>
        </div>
      </div>

      {/* Daily Report Chart */}
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
                    <Button
                      variant="outline"
                      className="w-full sm:w-[160px] justify-start text-left font-normal"
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(
                        new Date(selectedYear, selectedMonth),
                        "MMM yyyy"
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-4" align="start">
                    <div className="space-y-4">
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Month
                        </label>
                        <Select
                          value={selectedMonth.toString()}
                          onValueChange={(value) =>
                            setSelectedMonth(Number.parseInt(value))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {monthOptions.map((month, index) => (
                              <SelectItem key={index} value={index.toString()}>
                                {month}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-sm font-medium mb-2 block">
                          Year
                        </label>
                        <Select
                          value={selectedYear.toString()}
                          onValueChange={(value) =>
                            setSelectedYear(Number.parseInt(value))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {yearOptions.map((year) => (
                              <SelectItem key={year} value={year.toString()}>
                                {year}
                              </SelectItem>
                            ))}
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
              <ChartContainer
                className="h-[400px] w-full"
                config={{
                  redemptions: {
                    label: "Redemptions",
                    color: "hsl(var(--chart-1))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={dailyData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 50 }}
                  >
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v) =>
                        format(new Date(v + "T00:00:00"), "MMM d")
                      }
                      interval={0} // Show all dates
                      angle={-45} // Rotate labels for better readability
                      textAnchor="end"
                      height={70}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      label={{
                        value: "Redemptions",
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "rgba(0, 0, 0, 0.1)" }}
                    />
                    <Bar
                      dataKey="redemptions"
                      fill="var(--color-redemptions)"
                      radius={[4, 4, 0, 0]}
                      name="Redemptions"
                      label={{
                        position: "top",
                        fill: "var(--foreground)",
                        fontSize: 12,
                      }}
                    />
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

      {/* Monthly Report Chart */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
            <CardTitle>Monthly Sales Trend</CardTitle>
            <Select
              value={yearFilter.toString()}
              onValueChange={(value) => setYearFilter(Number.parseInt(value))}
            >
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
              <ChartContainer
                className="h-[400px] w-full"
                config={{
                  redemptions: {
                    label: "Redemptions",
                    color: "hsl(var(--chart-2))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={monthlyData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 50 }}
                  >
                    <XAxis
                      dataKey="month"
                      angle={-45}
                      textAnchor="end"
                      height={70} // Increase height for rotated labels
                      tick={{ fontSize: 12 }}
                      tickFormatter={(val) => {
                        // Parse year and month explicitly to avoid timezone issues
                        const [year, month] = val.split("-").map(Number);
                        const date = new Date(year, month - 1, 1); // month is 0-indexed
                        return format(date, "MMM yyyy");
                      }}
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      label={{
                        value: "Redemptions",
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "rgba(0, 0, 0, 0.1)" }}
                    />
                    <Bar
                      dataKey="redemptions"
                      fill="var(--color-redemptions)"
                      radius={[4, 4, 0, 0]}
                      name="Redemptions"
                      label={{
                        position: "top",
                        fill: "var(--foreground)",
                        fontSize: 12,
                      }}
                    />
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
