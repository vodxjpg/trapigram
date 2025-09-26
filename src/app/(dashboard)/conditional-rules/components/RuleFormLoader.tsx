"use client";

import { useEffect, useState } from "react";
import RuleForm from "./RuleForm";

type Rule = {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  priority?: number;
  countries?: string[];
  orderCurrencyIn?: string[];
  event: string;
  action: "send_coupon" | "product_recommendation" | "multi";
  channels: ("email" | "telegram" | "in_app" | "webhook")[];
  payload: any;
};

export default function RuleFormLoader({ id }: { id: string }) {
  const [rule, setRule]   = useState<Rule | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/rules/${id}`, {
          credentials: "include",
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        if (!res.ok) throw new Error(await res.text().catch(() => "Failed to load rule"));
        const data = (await res.json()) as Rule;
        if (!cancelled) setRule(data);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load rule");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <div className="p-4">Loading…</div>;
  if (error)   return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!rule)   return <div className="p-4">Not found.</div>;

  return (
    <RuleForm
      mode="edit"
      id={id}
      defaultValues={{
        name: rule.name,
        description: rule.description ?? "",
        enabled: rule.enabled,
        priority: rule.priority ?? 100,
        countries: rule.countries ?? [],
        orderCurrencyIn: rule.orderCurrencyIn ?? [],
        events: [rule.event], // single for edit
        onlyIfProductIdsAny: rule.payload?.onlyIfProductIdsAny ?? [],
      }}
      existingSingle={{
        event: rule.event,
        action: rule.action,
        channels: rule.channels,
        payload: rule.payload ?? {},
      }}
    />
  );
}
