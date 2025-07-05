"use client";

import * as React from "react";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect } from "react";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const description = "An interactive area chart";

type OrderStatus =
  | "open"
  | "paid"
  | "cancelled"
  | "refunded"
  | "underpaid"
  | "completed";

const getStatusColor = (s: OrderStatus) => {
  switch (s) {
    case "open":
      return "bg-blue-500";
    case "paid":
      return "bg-green-500";
    case "cancelled":
      return "bg-red-500";
    case "refunded":
      return "bg-red-500";
    case "underpaid":
      return "bg-orange-500";
    case "completed":
      return "bg-purple-500";
    default:
      return "bg-gray-500";
  }
};

// Updated chartConfig to use Total and Revenue
const chartConfig = {
  total: { label: "Total", color: "var(--color-desktop)" },
  revenue: { label: "Revenue", color: "var(--color-mobile)" },
} satisfies ChartConfig;

export default function DashboardPage() {
  const { setHeaderTitle } = useHeaderTitle();

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  useEffect(() => {
    setHeaderTitle("Dashboard");
  }, [setHeaderTitle]);

  const isMobile = useIsMobile();
  const [timeRange, setTimeRange] = React.useState<string>("90d");
  const [customRange, setCustomRange] = React.useState<{
    from?: Date;
    to?: Date;
  }>({});
  const [totalOrders, setTotalOrders] = React.useState<number | null>(null);
  const [totalRevenue, setTotalRevenue] = React.useState<number | null>(null);
  const [totalClient, setTotalClient] = React.useState<number | null>(null);
  const [totalActive, setTotalActive] = React.useState<number | null>(null);
  const [orderList, setOrderList] = React.useState<number | null>(null);
  const [growthRate, setGrowthRate] = React.useState<number | null>(null);
  const [chartData, setChartData] = React.useState<
    {
      date: string;
      total: number;
      revenue: number;
    }[]
  >([]);
  const [currency, setCurrency] = React.useState<"USD" | "GBP" | "EUR">("USD");

  // Compute from/to params for API based on selection
  const getFromToParams = (): { from: string; to: string } => {
    const toDate = new Date();
    let fromDate = new Date();

    if (timeRange === "custom" && customRange.from && customRange.to) {
      fromDate = customRange.from;
      toDate.setTime(customRange.to.getTime());
    } else {
      const days = timeRange === "30d" ? 30 : timeRange === "7d" ? 7 : 90;
      fromDate.setDate(toDate.getDate() - days);
    }
    return {
      from: fromDate.toISOString().split("T")[0],
      to: toDate.toISOString().split("T")[0],
    };
  };

  // Fetch total orders whenever range or custom dates change
  React.useEffect(() => {
    const fetchTotal = async () => {
      const { from, to } = getFromToParams();
      try {
        const resp = await fetch(
          `/api/dashboard?from=${from}&to=${to}&currency=${currency}`
        );
        if (!resp.ok) throw new Error("Network response was not ok");
        const {
          orderAmount,
          revenue,
          clientAmount,
          activeAmount,
          orderList,
          chartData,
          growthRate,
        } = await resp.json();
        setTotalOrders(orderAmount);
        setTotalRevenue(revenue);
        setTotalClient(clientAmount);
        setTotalActive(activeAmount);
        setOrderList(orderList);
        setChartData(chartData);
        setGrowthRate(growthRate);
      } catch (error) {
        console.error("Failed to fetch dashboard:", error);
      }
    };

    fetchTotal();
  }, [timeRange, customRange, currency]);

  React.useEffect(() => {
    if (isMobile) {
      setTimeRange("7d");
    }
  }, [isMobile]);

  const filteredData = chartData;

  React.useEffect(() => {
    // Only show the tour once per user
    const hasSeen = localStorage.getItem("hasSeenDriverTour");
    if (!hasSeen) {
      const tour = driver({
        showProgress: true,
        allowClose: true,
        overlayOpacity: 0.5,
        steps: [
          {
            popover: {
              title: "Welcome to Trapyfy",
              description:
                "This quick tour will walk you through the main sections of Trapyfy, so you can get started managing your business with confidence.",
            },
          },
          {
            element: ".Organizations",
            popover: {
              title: "Organizations",
              description:
                "Here you can switch between different organizations or create a new one. Use this to keep your teams and data neatly separated.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Shops",
            popover: {
              title: "Shops",
              description:
                "Under each organization you can set up one or more shops. Configure shop details, locations and payment settings here.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Inventory",
            popover: {
              title: "Inventory",
              description:
                "Manage your entire catalog: add or edit products, track stock levels in real time, set up tiered pricing and assign warehouses.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Clients",
            popover: {
              title: "Clients & Support",
              description:
                "View and maintain client profiles, see purchase history, and respond directly to any support tickets they submit.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Marketing",
            popover: {
              title: "Marketing",
              description:
                "Create and manage affiliate partnerships, generate discount coupons for promotions, and schedule site-wide announcements.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Orders",
            popover: {
              title: "Orders & Reviews",
              description:
                "Process incoming orders, update their status, handle refunds or returns, and read customer reviews to gather feedback.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Analytics",
            popover: {
              title: "Reports",
              description:
                "Dive into analytics: view product performance, coupon redemption rates, revenue trends, and export charts for deeper insights.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Sections",
            popover: {
              title: "Sections",
              description:
                "Organize and customize the content sections of your site or dashboard. Add, rename or reorder modules to suit your workflow.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Shipping",
            popover: {
              title: "Shipping",
              description:
                "Define shipping methods, connect with carrier services, and set regional rates to streamline order fulfillment.",
              side: "left",
              align: "start",
            },
          },
          {
            element: ".Payment.methods",
            popover: {
              title: "Payment Methods",
              description:
                "Enable, disable or configure payment gateways. Manage accepted card types, currencies and transaction fees securely.",
              side: "left",
              align: "start",
            },
          },
        ],
      });

      // start the tour
      tour.drive();

      // mark as shown
      localStorage.setItem("hasSeenDriverTour", "true");
    }
  }, []);

  // dashboard components
  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <Card className="@container/card">
              <CardHeader>
                <CardTitle>Total Orders: </CardTitle>
                <CardDescription>
                  <CardDescription>
                    {totalOrders !== null ? `${totalOrders}` : "Loading..."}
                  </CardDescription>
                  <span className="@[540px]/card:hidden">Last 3 months</span>
                </CardDescription>
                <CardAction>
                  <ToggleGroup
                    type="single"
                    value={timeRange}
                    onValueChange={setTimeRange}
                    variant="outline"
                    className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
                  >
                    <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
                    <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
                    <ToggleGroupItem value="7d">
                      Last 7 days
                    </ToggleGroupItem>{" "}
                  </ToggleGroup>
                  <Select value={timeRange} onValueChange={setTimeRange}>
                    <SelectTrigger
                      className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
                      size="sm"
                      aria-label="Select a value"
                    >
                      <SelectValue placeholder="Last 3 months" />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="90d" className="rounded-lg">
                        Last 3 months
                      </SelectItem>
                      <SelectItem value="30d" className="rounded-lg">
                        Last 30 days
                      </SelectItem>
                      <SelectItem value="7d" className="rounded-lg">
                        Last 7 days
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </CardAction>
              </CardHeader>
            </Card>
          </div>
          <div className="*:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card dark:*:data-[slot=card]:bg-card grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Total Revenue</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {totalRevenue !== null ? `${totalRevenue}$` : "Loading..."}
                </CardTitle>
                <CardAction className="flex items-center space-x-2">
                  <Select
                    value={currency}
                    onValueChange={setCurrency}
                    size="sm"
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="USD" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </CardAction>
              </CardHeader>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Revenue Growth Rate</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {growthRate !== null
                    ? `${growthRate.toFixed(2)}%`
                    : "Loading..."}
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">
                    <IconTrendingUp />
                    {growthRate !== null
                      ? `+${growthRate.toFixed(2)}%`
                      : "Loading..."}
                  </Badge>
                </CardAction>
              </CardHeader>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>New Customers</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {totalClient !== null ? `${totalClient}` : "Loading..."}
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">
                    <IconTrendingDown />
                    -20%
                  </Badge>
                </CardAction>
              </CardHeader>
            </Card>
            <Card className="@container/card">
              <CardHeader>
                <CardDescription>Active Accounts</CardDescription>
                <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
                  {totalActive !== null ? `${totalActive}` : "Loading..."}
                </CardTitle>
                <CardAction>
                  <Badge variant="outline">
                    <IconTrendingUp />
                    +12.5%
                  </Badge>
                </CardAction>
              </CardHeader>
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
                      <linearGradient
                        id="fillTotal"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
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
                      <linearGradient
                        id="fillRevenue"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
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
                      tickFormatter={(value) =>
                        new Date(value).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })
                      }
                    />
                    <ChartTooltip
                      cursor={false}
                      defaultIndex={isMobile ? -1 : 10}
                      content={
                        <ChartTooltipContent
                          labelFormatter={(value) =>
                            new Date(value).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })
                          }
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
          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-2xl font-bold">Orders</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="font-semibold">
                          Order Nro
                        </TableHead>
                        <TableHead className="font-semibold">User</TableHead>
                        <TableHead className="font-semibold">Status</TableHead>
                        <TableHead className="font-semibold text-right">
                          Total
                        </TableHead>
                        <TableHead className="font-semibold">Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderList !== null ? (
                        orderList.map((order) => (
                          <TableRow
                            key={order.id}
                            className="hover:bg-muted/50"
                          >
                            <TableCell className="font-medium">
                              {order.orderNumber}
                            </TableCell>
                            <TableCell>{order.user}</TableCell>
                            <TableCell>
                              <Badge
                                className={`${getStatusColor(order.status)} text-white hover:${getStatusColor(order.status)}/80 capitalize`}
                              >
                                {order.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {formatCurrency(order.total)}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {formatDate(order.date)}
                            </TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow>
                          <TableCell colSpan={5} className="text-center py-4">
                            Loading…
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
