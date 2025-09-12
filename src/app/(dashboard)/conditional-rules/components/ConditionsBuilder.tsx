"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import ProductMulti from "./ProductMulti";

export type ConditionItem =
  | { kind: "contains_product"; productIds: string[] }
  | { kind: "order_total_gte_eur"; amount: number }
  | { kind: "no_order_days_gte"; days: number };

export type ConditionsGroup = {
  op: "AND" | "OR";
  items: ConditionItem[];
};

export default function ConditionsBuilder({
  value,
  onChange,
  disabled,
}: {
  value: ConditionsGroup;
  onChange: (v: ConditionsGroup) => void;
  disabled?: boolean;
}) {
  const setOp = (op: "AND" | "OR") => onChange({ ...value, op });

  const updateItem = (idx: number, patch: Partial<ConditionItem>) => {
    const next = [...value.items];
    next[idx] = { ...next[idx], ...patch } as ConditionItem;
    onChange({ ...value, items: next });
  };

  const changeKind = (idx: number, kind: ConditionItem["kind"]) => {
    const next = [...value.items];
    next[idx] =
      kind === "contains_product" ? { kind, productIds: [] }
      : kind === "order_total_gte_eur" ? { kind, amount: 0 }
      : { kind, days: 30 };
    onChange({ ...value, items: next });
  };

  const addItem = () => {
    onChange({
      ...value,
      items: [...value.items, { kind: "contains_product", productIds: [] }],
    });
  };

  const removeItem = (idx: number) => {
    const next = value.items.filter((_, i) => i !== idx);
    onChange({ ...value, items: next });
  };

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
        {value.items.map((it, idx) => (
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
                  <SelectItem value="contains_product">Contains product</SelectItem>
                  <SelectItem value="order_total_gte_eur">Order total ≥ amount</SelectItem>
                  <SelectItem value="no_order_days_gte">No order in ≥ days</SelectItem>
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
