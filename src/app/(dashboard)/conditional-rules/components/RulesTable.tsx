"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type RuleRow = {
  id: string;
  name: string;
  event: string;
  enabled: boolean;
  countries: string[];
  orderCurrencyIn: string[];
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: ("email" | "telegram" | "in_app" | "webhook")[];
  payload: any;
  priority: number;
  updatedAt?: string;
};

function ConditionsSummary(r: RuleRow) {
  const hasCountries = (r.countries ?? []).length > 0;
  const hasCur = (r.orderCurrencyIn ?? []).length > 0;
  return (
    <div className="flex flex-wrap gap-1">
      {hasCountries ? (
        <Badge variant="outline">Countries: {r.countries.join(",")}</Badge>
      ) : (
        <Badge variant="secondary">Countries: ALL</Badge>
      )}
      {hasCur ? (
        <Badge variant="outline">Currency: {r.orderCurrencyIn.join(",")}</Badge>
      ) : (
        <Badge variant="secondary">Currency: ALL</Badge>
      )}
    </div>
  );
}

function ActionSummary(r: RuleRow) {
  if (r.action === "send_coupon") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Send coupon</span>
        {r.payload?.couponId && (
          <span className="text-muted-foreground">· {r.payload.couponId}</span>
        )}
        {r.payload?.code && (
          <span className="text-muted-foreground">· code:{r.payload.code}</span>
        )}
        <span className="ml-1 flex gap-1">
          {(r.channels ?? []).map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </span>
      </div>
    );
  }

  if (r.action === "product_recommendation") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Recommend product</span>
        {Array.isArray(r.payload?.productIds) && r.payload.productIds.length > 0 && (
          <span className="text-muted-foreground">· {r.payload.productIds.join(",")}</span>
        )}
        {r.payload?.collectionId && (
          <span className="text-muted-foreground">· collection:{r.payload.collectionId}</span>
        )}
        <span className="ml-1 flex gap-1">
          {(r.channels ?? []).map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </span>
      </div>
    );
  }

  if (r.action === "multi") {
    const actions = Array.isArray(r.payload?.actions) ? r.payload.actions : [];
    const labels = actions.map((a: any) => a?.type).filter(Boolean);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span>Multi</span>
        {labels.length > 0 && (
          <span className="text-muted-foreground">· {labels.join(", ")}</span>
        )}
        <span className="ml-1 flex gap-1">
          {(r.channels ?? []).map((c) => (
            <Badge key={c} variant="outline">
              {c}
            </Badge>
          ))}
        </span>
      </div>
    );
  }

  return <span>-</span>;
}

export default function RulesTable() {
  const [rows, setRows] = useState<RuleRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/rules", {
        // prevent stale
        cache: "no-store",
        headers: { accept: "application/json" },
        // include cookies/session in case you’re on a custom domain setup
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
          <th className="p-3 text-left">Action</th>
          <th className="p-3 text-left">Priority</th>
          <th className="p-3 text-left">Status</th>
          <th className="p-3 text-right">Actions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="border-t">
            <td className="p-3 font-medium">{r.name}</td>
            <td className="p-3">{r.event}</td>
            <td className="p-3">
              <ConditionsSummary {...r} />
            </td>
            <td className="p-3">
              <ActionSummary {...r} />
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
        ))}

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
