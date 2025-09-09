// src/app/(dashboard)/purchase-supply-orders/components/purchase-supply-orders-data-table.tsx
"use client";

import {
    useEffect,
    useMemo,
    useState,
    startTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
    type ColumnDef,
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { MoreHorizontal, FileDown, CheckCircle2, Plus, Edit } from "lucide-react";
import { toast } from "sonner";

type OrderStatus = "draft" | "pending" | "completed";

export type PurchaseSupplyOrder = {
    id: string;
    supplier: { id: string; name: string } | null;
    note: string | null;
    expectedAt: string | null; // ISO
    status: OrderStatus;
    createdAt: string; // ISO
};

type ServerResponse = {
    items: PurchaseSupplyOrder[];
    totalPages: number;
};

export default function PurchaseSupplyOrdersDataTable() {
    const router = useRouter();

    // toolbar state
    const [query, setQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");

    // paging
    const [page, setPage] = useState<number>(1);
    const [pageSize, setPageSize] = useState<number>(10);

    // data
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [orders, setOrders] = useState<PurchaseSupplyOrder[]>([]);
    const [totalPages, setTotalPages] = useState<number>(1);

    // fetch list
    useEffect(() => {
        const ctrl = new AbortController();
        (async () => {
            try {
                setIsLoading(true);
                const url = new URL("/api/suppliersOrder", window.location.origin);
                url.searchParams.set("page", String(page));
                url.searchParams.set("pageSize", String(pageSize));
                if (query.trim()) url.searchParams.set("search", query.trim());
                if (statusFilter) url.searchParams.set("status", statusFilter);

                const res = await fetch(url.toString(), { signal: ctrl.signal });
                if (!res.ok) throw new Error("Failed to load orders");
                const data: ServerResponse = await res.json();
                setOrders(data.items ?? []);
                setTotalPages(data.totalPages ?? 1);
            } catch (e: any) {
                if (e?.name !== "AbortError") toast.error(e?.message || "Error loading orders");
            } finally {
                setIsLoading(false);
            }
        })();
        return () => ctrl.abort();
    }, [page, pageSize, query, statusFilter]);

    // actions
    const handleCompleteOrder = async (id: string) => {
        try {
            const res = await fetch(`/api/suppliersOrder/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: "pending" as OrderStatus }),
            });
            if (!res.ok) throw new Error(await res.text().catch(() => "Failed to complete order"));
            toast.success("Order moved to Pending");
            // refresh current page
            setPage((p) => p); // triggers refetch due to effect deps
        } catch (e: any) {
            toast.error(e?.message || "Could not complete order");
        }
    };

    const handleExportPDF = (id: string) => {
        // Open an export endpoint in a new tab; adapt to your API if needed
        window.open(`/api/suppliersOrder/${id}/export?format=pdf`, "_blank");
    };

    const columns = useMemo<ColumnDef<PurchaseSupplyOrder>[]>(
        () => [
            {
                accessorKey: "supplier",
                header: "Supplier",
                cell: ({ row }) => (
                    <div className="font-medium">
                        {row.original.supplier?.name ?? "—"}
                    </div>
                ),
            },
            {
                accessorKey: "status",
                header: "Status",
                cell: ({ row }) => {
                    const s = row.original.status;
                    const classMap: Record<OrderStatus, string> = {
                        draft: "border-gray-200 bg-gray-50 text-gray-700",
                        pending: "border-amber-200 bg-amber-50 text-amber-700",
                        completed: "border-green-200 bg-green-50 text-green-700",
                    };
                    return (
                        <Badge variant="outline" className={classMap[s]}>
                            {s.charAt(0).toUpperCase() + s.slice(1)}
                        </Badge>
                    );
                },
            },
            {
                accessorKey: "note",
                header: "Note",
                cell: ({ row }) => (
                    <div className="max-w-[28ch] truncate text-sm text-muted-foreground">
                        {row.original.note || "—"}
                    </div>
                ),
            },
            {
                accessorKey: "expectedAt",
                header: "Expected Date",
                cell: ({ row }) => {
                    const v = row.original.expectedAt;
                    if (!v) return <span className="text-sm text-muted-foreground">—</span>;
                    const d = new Date(v);
                    return (
                        <div className="text-sm">
                            {!isNaN(d.getTime()) ? format(d, "PPP") : "—"}
                        </div>
                    );
                },
            },
            {
                id: "actions",
                header: "",
                cell: ({ row }) => {
                    const { id, status } = row.original;
                    const canComplete = status === "draft";
                    const canEdit = status !== "completed"; // ← disable when completed
                    return (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="ghost" className="h-8 w-8 p-0">
                                    <span className="sr-only">Open menu</span>
                                    <MoreHorizontal className="h-4 w-4" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>

                                {/* NEW: Edit */}
                                <DropdownMenuItem
                                    disabled={!canEdit}
                                    onClick={() => canEdit && router.push(`/supplier-order/${id}`)}
                                >
                                    <Edit className="mr-2 h-4 w-4" />
                                    Edit
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                    disabled={!canComplete}
                                    onClick={() => canComplete && handleCompleteOrder(id)}
                                >
                                    <CheckCircle2 className="mr-2 h-4 w-4" />
                                    Complete order
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => handleExportPDF(id)}>
                                    <FileDown className="mr-2 h-4 w-4" />
                                    Export to PDF
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    );
                },
            },
        ],
        [router] // ← add router as a dependency
    );

    const table = useReactTable({
        data: orders,
        columns,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getSortedRowModel: getSortedRowModel(),
    });

    return (
        <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Input
                        placeholder="Search by supplier or note..."
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

                    {/* Status filter */}
                    <Select
                        value={statusFilter || "all"}
                        onValueChange={(v) => {
                            startTransition(() => {
                                setStatusFilter(v === "all" ? "" : (v as OrderStatus));
                                setPage(1);
                            });
                        }}
                    >
                        <SelectTrigger className="w-full sm:w-[180px]">
                            <SelectValue placeholder="Filter by status" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">All Statuses</SelectItem>
                            <SelectItem value="draft">
                                <Badge variant="outline" className="border-gray-200 bg-gray-50 text-gray-700">
                                    Draft
                                </Badge>
                            </SelectItem>
                            <SelectItem value="pending">
                                <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                    Pending
                                </Badge>
                            </SelectItem>
                            <SelectItem value="completed">
                                <Badge variant="outline" className="border-green-200 bg-green-50 text-green-700">
                                    Completed
                                </Badge>
                            </SelectItem>
                        </SelectContent>
                    </Select>

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
                        <SelectTrigger className="w-full sm:w-[100px]">
                            <SelectValue placeholder="Page size" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="20">20</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* New Order (replaces Import/Export/Add product) */}
                <Button onClick={() => router.push("/supplier-order/new")}>
                    <Plus className="mr-2 h-4 w-4" />
                    New Order
                </Button>
            </div>

            {/* Table */}
            <div className="rounded-md border overflow-x-auto">
                <Table>
                    <TableHeader>
                        {table.getHeaderGroups().map((hg) => (
                            <TableRow key={hg.id}>
                                {hg.headers.map((h) => (
                                    <TableHead key={h.id}>
                                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                                    </TableHead>
                                ))}
                            </TableRow>
                        ))}
                    </TableHeader>

                    <TableBody>
                        {isLoading ? (
                            Array.from({ length: 5 }).map((_, r) => (
                                <TableRow key={r}>
                                    {Array.from({ length: columns.length }).map((_, c) => (
                                        <TableCell key={c}>
                                            <Skeleton className="h-6 w-full" />
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : table.getRowModel().rows?.length ? (
                            table.getRowModel().rows.map((row) => (
                                <TableRow key={row.id}>
                                    {row.getVisibleCells().map((cell) => (
                                        <TableCell key={cell.id}>
                                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))
                        ) : (
                            <TableRow>
                                <TableCell colSpan={columns.length} className="h-24 text-center">
                                    No orders found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* Pagination */}
            <div className="flex items-center justify-between space-x-2 py-4">
                <div className="text-sm text-muted-foreground">
                    Page {page} of {Math.max(totalPages, 1)}
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1 || isLoading}
                    >
                        Previous
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => p + 1)}
                        disabled={page >= totalPages || isLoading}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    );
}
