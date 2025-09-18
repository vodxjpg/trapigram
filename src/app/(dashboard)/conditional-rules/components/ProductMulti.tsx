// src/app/(dashboard)/conditional-rules/components/ProductMulti.tsx
"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Item = { id: string; title: string; sku?: string | null };

export default function ProductMulti({
  label = "Products",
  value,
  onChange,
  disabled,
}: {
  label?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [term, setTerm] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [results, setResults] = React.useState<Item[]>([]);

  // simple debounce
  React.useEffect(() => {
    const q = term.trim();
    const t = setTimeout(async () => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=12&ownedOnly=1`,
          { headers: { accept: "application/json" }, cache: "no-store" }
        );
        const body = await res.json().catch(() => ({ products: [] }));
        const items: Item[] = (body.products ?? []).map((p: any) => ({
          id: p.id,
          title: p.title ?? p.sku ?? p.id,
          sku: p.sku ?? null,
        }));
        setResults(items);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  const add = (id: string) => {
    if (!value.includes(id)) onChange([...value, id]);
  };
  const remove = (id: string) => onChange(value.filter((v) => v !== id));

  return (
    <div className="grid gap-3">
      <div className="space-y-2">
        <label className="text-sm font-medium">{label}</label>
        <Input
          placeholder="Search products (min 2 chars)…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          disabled={disabled}
        />
      </div>

      {/* Selected chips */}
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">None selected</span>
        )}
        {value.map((id) => (
          <Badge key={id} variant="secondary" className="flex items-center gap-2">
            <span className="truncate max-w-[220px]">{id}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-5 px-1"
              onClick={() => remove(id)}
              disabled={disabled}
            >
              ×
            </Button>
          </Badge>
        ))}
      </div>

      {/* Results */}
      <div className="rounded-lg border">
        <div className="p-2 text-xs text-muted-foreground">
          {loading ? "Searching…" : "Results"}
        </div>
        <ul className="max-h-64 overflow-auto divide-y">
          {results.map((r) => {
            const selected = value.includes(r.id);
            return (
              <li key={r.id} className="flex items-center justify-between p-2 gap-3">
                <div className="min-w-0">
                  <div className="truncate">{r.title}</div>
                  {r.sku && (
                    <div className="text-xs text-muted-foreground truncate">SKU: {r.sku}</div>
                  )}
                </div>
                <Button
                  type="button"
                  variant={selected ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => (selected ? remove(r.id) : add(r.id))}
                  disabled={disabled}
                >
                  {selected ? "Remove" : "Add"}
                </Button>
              </li>
            );
          })}
          {!loading && results.length === 0 && (
            <li className="p-2 text-sm text-muted-foreground">No results</li>
          )}
        </ul>
      </div>
    </div>
  );
}
