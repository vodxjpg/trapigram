// src/app/(dashboard)/conditional-rules/components/RulesTable.tsx
"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Channel = "email" | "telegram" | "in_app" | "webhook";

type RuleRow = {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  countries: string[];
  orderCurrencyIn: string[]; // may be unused; kept for compatibility
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: Channel[];
  payload: any;
  priority: number;
  updatedAt?: string;
};

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

const nbsp = "\u00A0";

function joinWithCommaLimited(items: string[], max = 2): string {
  if (items.length <= max) return items.join(", ");
  return `${items.slice(0, max).join(", ")}, ...`;
}

function euro(n: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  // compact but readable: avoid too many decimals for integers
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

/* ------------------------- Conditions rendering ------------------------- */

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
        if (ids.length === 0) {
          labels.push("Contains product");
        } else if (ids.length === 1) {
          labels.push(`Contains product`);
        } else {
          labels.push(`Contains products`);
        }
        break;
      }
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

  // Also surface selected countries as a readable “condition”-like filter.
  // This will only show if there’s room (top 2 chips logic is applied later in the cell).
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

/* --------------------------- Actions rendering -------------------------- */

function buildActionLabels(r: RuleRow): string[] {
  const texts: string[] = [];
  const p = r.payload ?? {};

  const pushChannelsSuffix = (base: string) => {
    // channels shown as visual badges elsewhere; keep labels concise
    texts.push(base);
  };

  if (r.action === "send_coupon") {
    const id = p?.couponId ? ` (#${String(p.couponId).slice(0, 6)}...)` : "";
    pushChannelsSuffix(`Send coupon`);
    return texts;
  }

  if (r.action === "product_recommendation") {
    const ids: string[] = Array.isArray(p?.productIds) ? p.productIds : [];
    if (ids.length === 0) {
      pushChannelsSuffix("Recommend products");
    } else if (ids.length === 1) {
      pushChannelsSuffix(`Recommend product `);
    } else {
      pushChannelsSuffix(`Recommend products`);
    }
    return texts;
  }

  // multi
  const actions: Array<any> = Array.isArray(p?.actions) ? p.actions : [];
  for (const a of actions) {
    if (!a || typeof a !== "object") continue;
    const t = String(a.type || "").toLowerCase();
    const pay = a.payload ?? {};

    if (t === "send_coupon") {
      const id = pay?.couponId ? ` (#${String(pay.couponId).slice(0, 6)}...)` : "";
      texts.push(`Send coupon`);
    } else if (t === "product_recommendation") {
      const ids: string[] = Array.isArray(pay?.productIds) ? pay.productIds : [];
      if (ids.length === 0) {
        texts.push("Recommend products");
      } else if (ids.length === 1) {
        texts.push(`Recommend product`);
      } else {
        texts.push(`Recommend products`);
      }
    } else if (t === "multiply_points") {
      const factor = Number(pay?.factor ?? 0);
      if (Number.isFinite(factor) && factor > 0) {
        texts.push(`Multiplier ×${factor}`);
      } else {
        texts.push("Set points multiplier");
      }
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

/* ----------------------------- Table component ----------------------------- */

export default function RulesTable() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules", {
        cache: "no-store",
        headers: { accept: "application/json" },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch rules");
      const body = await res.json();
      setRows(body.rules ?? []);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
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

  if (loading) {
    return (
      <div className="p-6 text-center text-muted-foreground">Loading…</div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/40">
        <tr>
          <th className="p-3 text-left">Name</th>
          <th className="p-3 text-left">Event</th>
          <th className="p-3 text-left">Conditions</th>
          <th className="p-3 text-left">Actions</th>
          <th className="p-3 text-left">Priority</th>
          <th className="p-3 text-left">Status</th>
          <th className="p-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const conditionLabels = buildConditionLabels(r);
          const actionLabels = buildActionLabels(r);

          return (
            <tr key={r.id} className="border-t">
              <td className="p-3 font-medium">{r.name}</td>
              <td className="p-3">{humanEvent(r.event)}</td>

              {/* Conditions: show up to 2 chips, then "..." */}
              <td className="p-3 align-top">
                {chipsLimited(conditionLabels, 2)}
              </td>

              {/* Actions: show up to 2 chips, then "..." + channel badges on the right */}
              <td className="p-3">
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
              </td>

              <td className="p-3">{r.priority ?? 100}</td>
              <td className="p-3">
                {r.enabled ? (
                  <Badge variant="default">Enabled</Badge>
                ) : (
                  <Badge variant="secondary">Disabled</Badge>
                )}
              </td>
              <td className="p-3 text-right">
                <div className="flex justify-end gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/conditional-rules/edit/${r.id}`}>Edit</Link>
                  </Button>

                  {r.enabled ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleEnabled(r.id, false)}
                    >
                      Disable
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => toggleEnabled(r.id, true)}
                    >
                      Enable
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => removeRule(r.id)}
                  >
                    Delete
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}

        {rows.length === 0 && (
          <tr>
            <td className="p-6 text-center text-muted-foreground" colSpan={7}>
              No rules yet. Click “New rule” to create your first automation.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
