"use client";

import * as React from "react";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { useReactTable, getCoreRowModel, type ColumnDef } from "@tanstack/react-table";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StandardDataTable } from "@/components/data-table/data-table";

/* ───────────────────────── Types ───────────────────────── */

type Channel = "email" | "telegram" | "in_app" | "webhook";

type RuleRow = {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  countries: string[];
  orderCurrencyIn: string[]; // legacy; kept for compatibility
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: Channel[];
  payload: any;
  priority: number;
  updatedAt?: string;
};

/* ──────────────────────── Utilities ─────────────────────── */

function humanEvent(e: string) {
  const map: Record<string, string> = {
    order_placed: "Order placed",
    order_pending_payment: "Order pending payment",
    order_paid: "Order paid",
    order_partially_paid: "Order partially paid",
    order_completed: "Order completed",
    order_cancelled: "Order cancelled",
    order_refunded: "Order refunded",
    order_shipped: "Order shipped",
    order_message: "Order message",
    ticket_created: "Ticket created",
    ticket_replied: "Ticket replied",
    manual: "Manual",
    customer_inactive: "Customer inactive",
  };
  return map[e] ?? e;
}

function joinWithCommaLimited(items: string[], max = 2): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")}, ...`;
}

function euro(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return `€${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
}

function chip(text: string, key?: string | number) {
  return (
    <Badge key={key ?? text} variant="outline" className="font-normal">
      {text}
    </Badge>
  );
}

function chipsLimited(texts: string[], max = 2) {
  const shown = texts.slice(0, max);
  const extra = texts.length - shown.length;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t, i) => chip(t, i))}
      {extra > 0 && <span className="text-muted-foreground">...</span>}
    </div>
  );
}

/* ───────────── Conditions / Actions label builders ───────────── */

function buildConditionLabels(r: RuleRow): string[] {
  const labels: string[] = [];
  const payload = r.payload ?? {};
  const cg = payload?.conditions ?? {};
  const items: Array<any> = Array.isArray(cg?.items) ? cg.items : [];

  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    switch (it.kind) {
      case "contains_product": {
        const ids: string[] = Array.isArray(it.productIds) ? it.productIds : [];
        if (ids.length === 0) labels.push("Contains product");
        else if (ids.length === 1) labels.push("Contains product");
        else labels.push("Contains products");
        break;
      }
      case "order_total_gte": {
        const amt = Number(it.amount ?? 0);
        labels.push(`Total ≥ ${euro(amt)}`);
        break;
      }
      // Back-compat: show legacy kind the same as the new one
      case "order_total_gte_eur": {
        const amt = Number(it.amount ?? 0);
        labels.push(`Total ≥ ${euro(amt)}`);
        break;
      }
      case "no_order_days_gte": {
        const d = Number(it.days ?? 0);
        labels.push(`No orders ≥ ${Math.max(1, d)}d`);
        break;
      }
      default:
        break;
    }
  }

  // Countries as a readable filter
  if (Array.isArray(r.countries) && r.countries.length > 0) {
    const ctext =
      r.countries.length === 1
        ? `Country: ${r.countries[0]}`
        : `Countries: ${joinWithCommaLimited(r.countries, 2)}`;
    labels.push(ctext);
  }

  if (labels.length === 0) labels.push("None");
  return labels;
}

function buildActionLabels(r: RuleRow): string[] {
  const texts: string[] = [];
  const p = r.payload ?? {};

  if (r.action === "send_coupon") {
    texts.push("Send coupon");
    return texts;
  }

  if (r.action === "product_recommendation") {
    const ids: string[] = Array.isArray(p?.productIds) ? p.productIds : [];
    if (ids.length === 0) texts.push("Recommend products");
    else if (ids.length === 1) texts.push("Recommend product");
    else texts.push("Recommend products");
    return texts;
  }

  const actions: Array<any> = Array.isArray(p?.actions) ? p.actions : [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const t = String(a.type || "").toLowerCase();
    const pay = a.payload ?? {};

    if (t === "send_coupon") {
      texts.push("Send coupon");
    } else if (t === "product_recommendation") {
      const ids: string[] = Array.isArray(pay?.productIds) ? pay.productIds : [];
      if (ids.length === 0) texts.push("Recommend products");
      else if (ids.length === 1) texts.push("Recommend product");
      else texts.push("Recommend products");
    } else if (t === "multiply_points") {
      const factor = Number(pay?.factor ?? 0);
      texts.push(Number.isFinite(factor) && factor > 0 ? `Multiplier ×${factor}` : "Set points multiplier");
    } else if (t === "award_points") {
      const pts = Number(pay?.points ?? 0);
      texts.push(Number.isFinite(pts) && pts > 0 ? `Award ${pts} pts` : "Award points");
    } else if (t) {
      texts.push(t);
    }
  }

  if (texts.length === 0) texts.push("None");
  return texts;
}

/* ─────────────────────────── Page ─────────────────────────── */

export default function RulesIndexPage() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/rules", {
        cache: "no-store",
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch rules");
      const body = await res.json();
      setRows(Array.isArray(body?.rules) ? body.rules : []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const toggleEnabled = async (id: string, enabled: boolean) => {
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) throw new Error("toggle failed");
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const removeRule = async (id: string) => {
    try {
      const res = await fetch(`/api/rules/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("delete failed");
      await load();
    } catch (e) {
      console.error(e);
    }
  };

  const columns = React.useMemo<ColumnDef<RuleRow, any>[]>(() => {
    return [
      {
        id: "name",
        header: "Name",
        cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
      },
      {
        id: "event",
        header: "Event",
        cell: ({ row }) => <span>{humanEvent(row.original.event)}</span>,
      },
      {
        id: "conditions",
        header: "Conditions",
        cell: ({ row }) => chipsLimited(buildConditionLabels(row.original), 2),
      },
      {
        id: "actions",
        header: "Actions",
        cell: ({ row }) => {
          const r = row.original;
          const actionLabels = buildActionLabels(r);
          return (
            <div className="flex items-start justify-between gap-3">
              <div>{chipsLimited(actionLabels, 2)}</div>
              {Array.isArray(r.channels) && r.channels.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {r.channels.map((c) => (
                    <Badge key={c} variant="secondary" className="font-normal">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          );
        },
      },
      {
        id: "priority",
        header: "Priority",
        cell: ({ row }) => <span>{row.original.priority ?? 100}</span>,
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) =>
          row.original.enabled ? (
            <Badge variant="default">Enabled</Badge>
          ) : (
            <Badge variant="secondary">Disabled</Badge>
          ),
      },
      {
        id: "controls",
        header: "",
        cell: ({ row }) => {
          const r = row.original;
          return (
            <div className="flex justify-end gap-2">
              <Button asChild size="sm" variant="outline">
                <Link href={`/conditional-rules/edit/${r.id}`}>Edit</Link>
              </Button>

              {r.enabled ? (
                <Button size="sm" variant="secondary" onClick={() => toggleEnabled(r.id, false)}>
                  Disable
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => toggleEnabled(r.id, true)}>
                  Enable
                </Button>
              )}

              <Button type="button" size="sm" variant="destructive" onClick={() => removeRule(r.id)}>
                Delete
              </Button>
            </div>
          );
        },
      },
    ];
  }, []);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Conditional rules</h1>
          <p className="text-sm text-muted-foreground">
            Automate actions based on events and conditions.
          </p>
        </div>
        <Button asChild>
          <Link href="/conditional-rules/new">New rule</Link>
        </Button>
      </div>

      <StandardDataTable
        table={table}
        columns={columns}
        isLoading={isLoading}
        skeletonRows={6}
        emptyMessage='No rules yet. Click “New rule” to create your first automation.'
        className="rounded-2xl"
      />
    </div>
  );
}
