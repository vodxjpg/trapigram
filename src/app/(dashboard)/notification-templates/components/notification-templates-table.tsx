// src/app/(dashboard)/notification-templates/components/notification-templates-table.tsx
"use client";

import * as React from "react";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { MoreVertical } from "lucide-react";
import { StandardDataTable } from "@/components/data-table/data-table";
import {
  ColumnDef,
  getCoreRowModel,
  useReactTable,
  createColumnHelper,
} from "@tanstack/react-table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NotificationType } from "@/lib/notifications";

/* ───────────────── Types ───────────────── */
interface TemplateRow {
  id: string;
  type: NotificationType;
  role: "admin" | "user";
  countries: string[]; // ISO 3166-1 alpha-2 codes (e.g. "IT", "ES")
  subject: string | null;
  updatedAt: string;
}

/* ───────────────── Helpers ───────────────── */

/** Natural language labels for types */
const TYPE_LABEL: Record<NotificationType, string> = {
  order_placed: "New orders",
  order_pending_payment: "Pending payments",
  order_partially_paid: "Partially paid orders",
  order_paid: "Paid orders",
  order_completed: "Completed orders",
  order_cancelled: "Cancelled orders",
  order_refunded: "Refunded orders",
  order_shipped: "Shipped orders",
  order_message: "Order messages",
  ticket_created: "Ticket created",
  ticket_replied: "Ticket replied",
  automation_rule: "Automation rule",
};

/** Colors aligned with orders table statuses */
const TYPE_BADGE_BG: Record<NotificationType, string> = {
  order_placed: "bg-blue-500",
  order_pending_payment: "bg-yellow-500",
  order_partially_paid: "bg-orange-500",
  order_paid: "bg-green-500",
  order_completed: "bg-purple-500",
  order_cancelled: "bg-red-500",
  order_refunded: "bg-red-500",
  order_shipped: "bg-blue-500",
  order_message: "bg-slate-500",
  ticket_created: "bg-indigo-500",
  ticket_replied: "bg-indigo-500",
  automation_rule: "bg-gray-500",
};

/** ISO country code → emoji flag (fallback to code) */
const ccToFlag = (cc: string) => {
  const code = (cc || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return code || "—";
  const A = 0x1f1e6;
  const flag = String.fromCodePoint(
    A + (code.charCodeAt(0) - 65),
    A + (code.charCodeAt(1) - 65),
  );
  return flag;
};

/** Localized region name using Intl (falls back to code) */
const regionName = (cc: string) => {
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    return dn.of(cc.toUpperCase()) ?? cc.toUpperCase();
  } catch {
    return cc.toUpperCase();
  }
};

export function NotificationTemplatesTable() {
  // get active org for permission checks
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  // secure permission checks
  const {
    hasPermission: canView,
    isLoading: viewLoading,
  } = useHasPermission(orgId, { notifications: ["view"] });
  const {
    hasPermission: canUpdate,
    isLoading: updateLoading,
  } = useHasPermission(orgId, { notifications: ["update"] });
  const {
    hasPermission: canDelete,
    isLoading: deleteLoading,
  } = useHasPermission(orgId, { notifications: ["delete"] });

  const [rows, setRows] = React.useState<TemplateRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  // fetch only if allowed to view
  React.useEffect(() => {
    if (!canView) return;
    (async () => {
      try {
        const r = await fetch("/api/notification-templates", {
          headers: {
            "x-internal-secret":
              process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
          },
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || "Fetch failed");
        }
        const data = (await r.json()) as (TemplateRow & {
          countries: string[] | string;
        })[];
        const normalized = data.map((d) => ({
          ...d,
          countries: Array.isArray(d.countries)
            ? d.countries
            : JSON.parse(d.countries || "[]"),
        })) as TemplateRow[];
        setRows(normalized);
      } catch (err: any) {
        toast.error(err.message || "Failed to load templates");
      } finally {
        setLoading(false);
      }
    })();
  }, [canView]);

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    if (!confirm("Delete this template? This cannot be undone.")) return;
    try {
      const r = await fetch(`/api/notification-templates/${id}`, {
        method: "DELETE",
        headers: {
          "x-internal-secret":
            process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
        },
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.error || "Delete failed");
      }
      setRows((prev) => prev.filter((t) => t.id !== id));
      toast.success("Template deleted");
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  // guard while perms resolving
  if (viewLoading) return null;

  // no view rights
  if (!canView) {
    return (
      <div className="p-6 text-center text-red-600">
        You don’t have permission to view notification templates.
      </div>
    );
  }

  /* ────────────── Columns ────────────── */
  const columnHelper = createColumnHelper<TemplateRow>();

  // NOTE: Use ColumnDef<TemplateRow, any>[] to avoid NotificationType vs unknown mismatch.
  const columns = React.useMemo<ColumnDef<TemplateRow, any>[]>(
    () => [
      columnHelper.accessor("type", {
        header: "Type",
        cell: ({ row }) => {
          const t = row.original.type;
          const label = TYPE_LABEL[t] ?? t.replace(/_/g, " ");
          const bg = TYPE_BADGE_BG[t] ?? "bg-gray-500";
          return (
            <div className="flex items-center gap-2">
              <span
                className={[
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white",
                  bg,
                ].join(" ")}
              >
                {label}
              </span>
            </div>
          );
        },
      }),
      columnHelper.accessor("role", {
        header: "Role",
        cell: ({ getValue }) => (
          <Badge variant="secondary" className="capitalize">
            {getValue()}
          </Badge>
        ),
      }),
      columnHelper.display({
        id: "countries",
        header: "Countries",
        cell: ({ row }) => {
          const countries = row.original.countries || [];
          if (!countries.length)
            return <span className="text-muted-foreground">Global</span>;

          const firstTwo = countries.slice(0, 2);
          const rest = countries.slice(2);

          return (
            <div className="flex items-center gap-1">
              {firstTwo.map((cc) => (
                <span
                  key={cc}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs"
                  title={regionName(cc)}
                >
                  <span aria-hidden>{ccToFlag(cc)}</span>
                  <span className="tracking-wide">{cc.toUpperCase()}</span>
                </span>
              ))}
              {rest.length > 0 && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-default items-center gap-1 rounded-md border px-2 py-0.5 text-xs">
                        +{rest.length}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      <div className="space-y-1">
                        <div className="text-xs font-medium">More countries</div>
                        <div className="text-xs text-muted-foreground">
                          {rest
                            .map(
                              (cc) =>
                                `${ccToFlag(cc)} ${regionName(cc)} (${cc.toUpperCase()})`,
                            )
                            .join(", ")}
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("subject", {
        header: "Subject",
        cell: ({ getValue }) => getValue() ?? "—",
      }),
      ...(canUpdate || canDelete
        ? [
            columnHelper.display({
              id: "actions",
              header: () => <div className="text-right">Actions</div>,
              cell: ({ row }) => (
                <div className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {canUpdate && !updateLoading && (
                        <DropdownMenuItem asChild>
                          <Link href={`/notification-templates/${row.original.id}/edit`}>
                            Edit
                          </Link>
                        </DropdownMenuItem>
                      )}
                      {canDelete && !deleteLoading && (
                        <DropdownMenuItem
                          onSelect={() => handleDelete(row.original.id)}
                          className="text-destructive"
                        >
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ),
            }),
          ]
        : []),
    ],
    [canUpdate, canDelete, updateLoading, deleteLoading],
  );

  /* ────────────── Table Instance ────────────── */
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <Card>
      <CardContent className="p-0">
        <StandardDataTable
          table={table}
          columns={columns}
          isLoading={loading}
          skeletonRows={6}
          emptyMessage="No templates yet"
          className="rounded-none border-0"
        />
      </CardContent>
    </Card>
  );
}
