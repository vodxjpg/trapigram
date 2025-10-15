// /src/app/(dashboard)/affiliates/logs-table.tsx
"use client";

import { useEffect, useState, startTransition, useMemo } from "react";
import Link from "next/link";
import { useDebounce } from "@/hooks/use-debounce";
import { endOfDay, format } from "date-fns";
import { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Calendar } from "@/components/ui/calendar";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  Calendar as CalendarIcon,
} from "lucide-react";
import { toast } from "sonner";

// ⬇️ TanStack + standardized table
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ───────────── Types ───────────── */
type Log = {
  id: string;
  organizationId: string;
  clientId: string;
  points: number;
  action: string;
  description: string | null;
  sourceClientId: string | null;
  createdAt: string;
  clientLabel?: string;
  sourceClientLabel?: string;
};

/* ───────────── Component ───────────── */
export function LogsTable() {
  // data
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  // paging
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  // search / filters
  const [query, setQuery] = useState("");
  const debounced = useDebounce(query, 300);

  // action filter (values populated from API results for convenience)
  const [actionFilter, setActionFilter] = useState<string>("");
  const [actionOptions, setActionOptions] = useState<string[]>([]);

  // points direction filter
  const [pointsFilter, setPointsFilter] = useState<"" | "gains" | "losses">("");

  // date range filter
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  const [range, setRange] = useState<DateRange | undefined>();

  // optional: mirror UI picker into actual filter
  useEffect(() => {
    setDateRange(range);
  }, [range]);

  /* fetch logs */
  const loadLogs = async () => {
    setLoading(true);
    try {
      const url = new URL("/api/affiliate/points", window.location.origin);
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));

      if (debounced.trim()) url.searchParams.set("search", debounced.trim());
      if (actionFilter) url.searchParams.set("action", actionFilter);
      if (pointsFilter) url.searchParams.set("direction", pointsFilter);
      if (dateRange?.from)
        url.searchParams.set("dateFrom", dateRange.from.toISOString());
      if (dateRange?.to)
        url.searchParams.set("dateTo", endOfDay(dateRange.to).toISOString());

      const r = await fetch(url.toString(), {
        headers: {
          "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET ?? "",
        },
      });

      if (!r.ok) {
        let msg = "Fetch failed";
        try {
          const j = await r.json();
          msg = j?.error || msg;
        } catch { }
        throw new Error(msg);
      }

      const { logs, totalPages, currentPage } = await r.json();
      const list: Log[] = Array.isArray(logs) ? logs : [];
      setLogs(list);
      setTotalPages(totalPages ?? 1);
      setPage(currentPage ?? page);

      // derive unique action options
      const unique = Array.from(new Set(list.map((l) => l.action).filter(Boolean)));
      setActionOptions(unique);
    } catch (e: any) {
      toast.error(e?.message || "Failed to load logs");
      setLogs([]);
      setTotalPages(1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, debounced, actionFilter, pointsFilter, dateRange?.from, dateRange?.to]);

  /* helpers */
  const fallbackId = (id: string | null | undefined) =>
    id ? id.slice(0, 8) + "…" : "-";

  const showingFrom = useMemo(
    () => (page - 1) * pageSize + (logs.length ? 1 : 0),
    [page, pageSize, logs.length]
  );
  const showingTo = useMemo(
    () => (page - 1) * pageSize + logs.length,
    [page, pageSize, logs.length]
  );

  /* columns */
  const columns = useMemo<ColumnDef<Log>[]>(
    () => [
      {
        id: "id",
        header: "ID",
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.id.slice(0, 8)}…</span>
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Date",
        cell: ({ row }) => (
          <div className="flex items-center gap-1">
            <Clock className="h-4 w-4 opacity-70" />
            {new Date(row.original.createdAt).toLocaleString()}
          </div>
        ),
      },
      {
        id: "client",
        header: "Client",
        cell: ({ row }) => (
          <Link href={`/clients/${row.original.clientId}/info`}>
            {row.original.clientLabel || fallbackId(row.original.clientId)}
          </Link>
        ),
      },
      {
        id: "delta",
        header: "Δ Points",
        cell: ({ row }) => {
          const p = row.original.points;
          return (
            <span className={p >= 0 ? "text-green-600" : "text-red-600"}>
              {p > 0 ? "+" : ""}
              {p}
            </span>
          );
        },
      },
      {
        accessorKey: "action",
        header: "Action",
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: ({ row }) => row.original.description ?? "-",
      },
      {
        id: "sourceClient",
        header: "Source Client",
        cell: ({ row }) =>
          row.original.sourceClientId ? (
            <Link href={`/clients/${row.original.sourceClientId}/info`}>
              {row.original.sourceClientLabel ||
                fallbackId(row.original.sourceClientId)}
            </Link>
          ) : (
            <span>-</span>
          ),
      },
    ],
    []
  );

  const table = useReactTable({
    data: logs,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  /* ───────────── JSX ───────────── */
  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {/* Search */}
          <Input
            placeholder="Search by description, action or client…"
            value={query}
            onChange={(e) => {
              const txt = e.target.value;
              startTransition(() => {
                setQuery(txt);
                setPage(1);
              });
            }}
            className="w-full sm:max-w-sm"
          />

          {/* Action filter */}
          <Select
            value={actionFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                setActionFilter(v === "all" ? "" : v);
                setPage(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[200px]">
              <SelectValue placeholder="Filter by action" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Actions</SelectItem>
              {actionOptions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Points direction filter */}
          <Select
            value={pointsFilter || "all"}
            onValueChange={(v) => {
              startTransition(() => {
                setPointsFilter(v === "all" ? "" : (v as "gains" | "losses"));
                setPage(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[180px]">
              <SelectValue placeholder="Filter by points" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Points</SelectItem>
              <SelectItem value="gains">Gains (+)</SelectItem>
              <SelectItem value="losses">Losses (−)</SelectItem>
            </SelectContent>
          </Select>

          {/* Date range filter */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="w-[260px] justify-start text-left font-normal"
              >
                <CalendarIcon className="mr-2 h-4 w-4" />
                {range?.from
                  ? range.to
                    ? `${format(range.from, "LLL d, y")} - ${format(
                      range.to,
                      "LLL d, y"
                    )}`
                    : format(range.from, "LLL d, y")
                  : "Any date"}
              </Button>
            </PopoverTrigger>

            <PopoverContent className="w-auto p-0 z-50" align="start" sideOffset={4}>
              <Calendar
                initialFocus
                mode="range"
                numberOfMonths={2}
                defaultMonth={range?.from}
                selected={range}
                onSelect={setRange}
              />
            </PopoverContent>
          </Popover>

          {/* Page-size selector */}
          <Select
            value={pageSize.toString()}
            onValueChange={(v) => {
              startTransition(() => {
                setPageSize(Number(v));
                setPage(1);
              });
            }}
          >
            <SelectTrigger className="w-full sm:w-[110px]">
              <SelectValue placeholder="Page size" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="20">20</SelectItem>
              <SelectItem value="50">50</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Standardized data table */}
      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={loading}
        skeletonRows={Math.min(pageSize, 10)}
        emptyMessage="No logs"
      />

      {/* Pagination */}
      <div className="flex items-center justify-between space-x-2 py-4">
        <div className="text-sm text-muted-foreground">
          Showing {showingFrom || 0} to {showingTo || 0} of many entries
        </div>
        <div className="flex items-center space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
