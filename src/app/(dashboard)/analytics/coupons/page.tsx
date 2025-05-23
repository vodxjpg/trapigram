"use client";

import { useState, useEffect } from "react";
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

interface CouponStats {
  month: string; // e.g. "2025-05"
  couponCode: string;
  redemptions: number;
  totalOrders: number;
  totalDiscount: number; // in cents or float
  revenueAfterDiscount: number;
}

export default function MonthlyCouponReport() {
  const [data, setData] = useState<CouponStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/report/coupon/");
        if (!res.ok) throw new Error("Failed to load coupon stats");
        const json = await res.json();
        setData(json.values.stats);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  // Sort by redemptions (highest first)
  const sortedData = [...data].sort((a, b) => b.redemptions - a.redemptions);

  if (loading) return <div>Loading report…</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">Coupon Performance Report</h1>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Monthly Coupon Performance</CardTitle>
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
                  <TableHead className="text-right">
                    Revenue After Discount
                  </TableHead>
                  <TableHead className="text-right">Avg Order Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((row) => {
                  const pct =
                    ((row.redemptions / row.totalOrders) * 100).toFixed(1) +
                    "%";
                  const avgAOV = (
                    row.revenueAfterDiscount / row.redemptions
                  ).toFixed(2);
                  return (
                    <TableRow key={`${row.month}-${row.couponCode}`}>
                      <TableCell>{row.month}</TableCell>
                      <TableCell>{row.couponCode}</TableCell>
                      <TableCell className="text-right">
                        {row.redemptions}
                      </TableCell>
                      <TableCell className="text-right">{pct}</TableCell>
                      <TableCell className="text-right">
                        ${row.totalDiscount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        ${row.revenueAfterDiscount.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">${avgAOV}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Coupon Redemptions - 2025-05</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[600px] w-full">
            {data.length > 0 ? (
              <ChartContainer
                className="h-[600px] w-full"
                config={{
                  redemptions: {
                    label: "Redemptions",
                    color: "hsl(var(--chart-1))",
                  },
                }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={data}
                    margin={{ top: 20, right: 30, left: 20, bottom: 70 }}
                  >
                    <XAxis
                      dataKey="couponCode"
                      angle={-45} // Rotate labels for better readability
                      textAnchor="end"
                      height={70} // Increase height for rotated labels
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis />
                    <ChartTooltip
                      content={<ChartTooltipContent />}
                      cursor={{ fill: "rgba(0, 0, 0, 0.1)" }}
                    />
                    <Bar
                      dataKey="redemptions"
                      fill="var(--color-redemptions)"
                      radius={[4, 4, 0, 0]}
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
                No coupon data available for this month
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
