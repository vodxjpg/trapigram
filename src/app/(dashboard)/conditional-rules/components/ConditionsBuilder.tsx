// src/app/(dashboard)/conditional-rules/components/ConditionsBuilder.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ProductMulti from "./ProductMulti";

export type ConditionItem =
  | { kind: "contains_product"; productIds: string[] }
  | { kind: "order_total_gte_eur"; amount: number }
  | { kind: "no_order_days_gte"; days: number };

export type ConditionsGroup = { op: "AND" | "OR"; items: ConditionItem[] };

export default function ConditionsBuilder({
  value,
  onChange,
  disabled,
  allowedKinds = ["contains_product", "order_total_gte_eur", "no_order_days_gte"],
}: {
  value: ConditionsGroup;
  onChange: (v: ConditionsGroup) => void;
  disabled?: boolean;
  allowedKinds?: Array<ConditionItem["kind"]>;
}) {
  const setOp = (op: "AND" | "OR") => onChange({ ...value, op });

  const ensureKindAllowed = (k: ConditionItem["kind"]) =>
    (allowedKinds as string[]).includes(k);

  const coerceKind = (k: ConditionItem["kind"]): ConditionItem =>
    k === "contains_product"
      ? { kind: "contains_product", productIds: [] }
      : k === "order_total_gte_eur"
      ? { kind: "order_total_gte_eur", amount: 0 }
      : { kind: "no_order_days_gte", days: 30 };

  const updateItem = (idx: number, patch: Partial<ConditionItem>) => {
    const next = [...value.items];
    next[idx] = { ...next[idx], ...patch } as ConditionItem;
    onChange({ ...value, items: next });
  };

  const changeKind = (idx: number, kind: ConditionItem["kind"]) => {
    const next = [...value.items];
    next[idx] = coerceKind(kind);
    onChange({ ...value, items: next });
  };

  const addItem = () => {
    // default to first allowed kind
    const firstKind = (allowedKinds[0] ?? "contains_product") as ConditionItem["kind"];
    onChange({ ...value, items: [...value.items, coerceKind(firstKind)] });
  };

  const removeItem = (idx: number) => {
    const next = value.items.filter((_, i) => i !== idx);
    onChange({ ...value, items: next });
  };

  // filter out any disallowed items (if trigger was changed)
  const items = value.items.filter((it) => ensureKindAllowed(it.kind));

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Label>Match</Label>
        <Select value={value.op} onValueChange={(v) => setOp(v as "AND" | "OR")} disabled={disabled}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="AND">ALL (AND)</SelectItem>
            <SelectItem value="OR">ANY (OR)</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">conditions</span>
      </div>

      <div className="grid gap-3">
        {items.map((it, idx) => (
          <div key={idx} className="grid gap-3 rounded-xl border p-3 md:p-4">
            <div className="flex items-center gap-3">
              <Label className="min-w-24">Type</Label>
              <Select
                value={it.kind}
                onValueChange={(v) => changeKind(idx, v as ConditionItem["kind"])}
                disabled={disabled}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allowedKinds.includes("contains_product") && (
                    <SelectItem value="contains_product">Contains product</SelectItem>
                  )}
                  {allowedKinds.includes("order_total_gte_eur") && (
                    <SelectItem value="order_total_gte_eur">Order total ≥ amount</SelectItem>
                  )}
                  {allowedKinds.includes("no_order_days_gte") && (
                    <SelectItem value="no_order_days_gte">No order in ≥ days</SelectItem>
                  )}
                </SelectContent>
              </Select>

              <div className="ml-auto">
                <Button type="button" variant="outline" onClick={() => removeItem(idx)} disabled={disabled}>
                  − Remove
                </Button>
              </div>
            </div>

            {it.kind === "contains_product" && (
              <ProductMulti
                label="Products"
                value={it.productIds || []}
                onChange={(ids) => updateItem(idx, { productIds: ids })}
                disabled={disabled}
              />
            )}

            {it.kind === "order_total_gte_eur" && (
              <div className="grid gap-2">
                <Label>Amount in EUR</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={Number.isFinite((it as any).amount) ? String((it as any).amount) : ""}
                  onChange={(e) => updateItem(idx, { amount: Number(e.target.value || 0) } as any)}
                  disabled={disabled}
                />
              </div>
            )}

            {it.kind === "no_order_days_gte" && (
              <div className="grid gap-2">
                <Label>Days threshold</Label>
                <Input
                  type="number"
                  min={1}
                  step="1"
                  value={Number.isFinite((it as any).days) ? String((it as any).days) : "30"}
                  onChange={(e) => updateItem(idx, { days: Number(e.target.value || 1) } as any)}
                  disabled={disabled}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <Button type="button" onClick={addItem} disabled={disabled}>
        + Add condition
      </Button>
    </div>
  );
}
