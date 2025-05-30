"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
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
import IndividualProductReport from "./[id]/individual-product-report";

interface ProductStats {
  id: string; // Product ID for linking to individual report
  month: string; // e.g. "2025-05"
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
  iso
    ? new Date(iso).toISOString().slice(0, 7) // "YYYY-MM"
    : "—";

export default function MonthlyProductReport() {
  const router = useRouter();
  const [data, setData] = useState<ProductStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [datePreset, setDatePreset] = useState<DatePreset>("currentMonth");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });
  const [isCustomDate, setIsCustomDate] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(
    null
  );

  // Generate date range based on preset
  const getDateRangeFromPreset = (preset: DatePreset): DateRange => {
    const today = new Date();

    switch (preset) {
      case "today":
        return {
          from: startOfDay(today),
          to: endOfDay(today),
        };
      case "yesterday":
        const yesterday = subDays(today, 1);
        return {
          from: startOfDay(yesterday),
          to: endOfDay(yesterday),
        };
      case "last7days":
        return {
          from: subDays(today, 6),
          to: today,
        };
      case "last30days":
        return {
          from: subDays(today, 29),
          to: today,
        };
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
        return dateRange; // Keep existing custom range
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

  // Format date range for display
  const formatDateRange = () => {
    const { from, to } = dateRange;

    if (datePreset === "today") {
      return "Today";
    } else if (datePreset === "yesterday") {
      return "Yesterday";
    } else if (from && to) {
      return `${format(from, "MMM d, yyyy")} - ${format(to, "MMM d, yyyy")}`;
    }
    return "";
  };

  // Handle product selection
  const handleProductSelect = (productId: string) => {
    router.push(`/analytics/products/${productId}`);
  };

  // Handle back to product list
  const handleBackToList = () => {
    setSelectedProductId(null);
  };

  useEffect(() => {
    async function fetchStats() {
      try {
        setLoading(true);
        // Format dates for API
        const fromDate = format(dateRange.from, "yyyy-MM-dd");
        const toDate = format(dateRange.to, "yyyy-MM-dd");

        const res = await fetch(
          `/api/report/product/?from=${fromDate}&to=${toDate}`
        );
        if (!res.ok) throw new Error("Failed to load product stats");
        const json = await res.json();
        setData(json.values.stats);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchStats();
  }, [dateRange]);

  // Sort by quantity (highest first)
  const sortedData = [...data].sort((a, b) => b.quantity - a.quantity);

  if (loading) return <div>Loading report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  // If a product is selected, show the individual product report
  if (selectedProductId) {
    return (
      <IndividualProductReport
        productId={selectedProductId}
        onBack={handleBackToList}
      />
    );
  }

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h1 className="text-3xl font-bold mb-4 md:mb-0">
          Product Performance Report
        </h1>

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
                <Button
                  variant="outline"
                  className="w-full sm:w-[300px] justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from && dateRange.to ? (
                    <>
                      {format(dateRange.from, "MMM d, yyyy")} -{" "}
                      {format(dateRange.to, "MMM d, yyyy")}
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
                  selected={{
                    from: dateRange.from,
                    to: dateRange.to,
                  }}
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
                  sortedData.map((row, index) => {
                    return (
                      <TableRow
                        key={`${row.month}-${row.product}-${index}`}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleProductSelect(row.id)}
                      >
                        <TableCell>{fmtYearMonth(row.month)}</TableCell>
                        <TableCell>{row.product}</TableCell>
                        <TableCell>{row.sku}</TableCell>
                        <TableCell className="text-right">
                          {row.quantity}
                        </TableCell>
                      </TableRow>
                    );
                  })
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
                config={{
                  quantity: {
                    label: "Quantity",
                    color: "hsl(var(--chart-1))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 70 }}
                  >
                    <XAxis
                      dataKey="product"
                      angle={-45} // Rotate labels for better readability
                      textAnchor="end"
                      height={70} // Increase height for rotated labels
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis
                      label={{
                        value: "Quantity",
                        angle: -90,
                        position: "insideLeft",
                      }}
                    />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "rgba(0, 0, 0, 0.1)" }}
                    />
                    <Bar
                      dataKey="quantity"
                      fill="var(--color-quantity)"
                      radius={[4, 4, 0, 0]}
                      label={{
                        position: "top",
                        fill: "var(--foreground)",
                        fontSize: 12,
                      }}
                      onClick={(data) => handleProductSelect(data.id)}
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
