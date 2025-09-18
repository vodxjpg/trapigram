// src/app/(dashboard)/conditional-rules/components/ProductMulti.tsx
"use client";

import * as React from "react";
import { useMemo, useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
  SelectGroup,
  SelectLabel,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search } from "lucide-react";
import ReactCountryFlag from "react-country-flag";
import { cn } from "@/lib/utils";

type StockMap = Record<string, number>;                    // { "ES": 12, "US": 0, ... }
type WarehouseMap = Record<string, StockMap>;              // { "wh1": {ES: 12}, "wh2": {...} }

type ProductRow = {
  id: string;
  title: string;
  sku?: string | null;
  allowBackorders?: boolean;
  stockData?: WarehouseMap;                                 // like in order create form
};

function stockForCountry(p: ProductRow, cc: string): number {
  return Object.values(p.stockData || {}).reduce(
    (sum, wh) => sum + (wh?.[cc] ?? 0),
    0
  );
}

function hasFiniteStock(p: ProductRow) {
  return Object.keys(p.stockData || {}).length > 0;
}

function isAvailableInCountry(p: ProductRow, cc: string) {
  // Affiliate/global items often have no stock map → treat as globally available
  if (!hasFiniteStock(p)) return true;
  const qty = stockForCountry(p, cc);
  return qty > 0 || !!p.allowBackorders;
}

function isCompatibleForRule(p: ProductRow, ruleCountries: string[]) {
  if (!ruleCountries?.length) return true; // no restriction
  return ruleCountries.every((cc) => isAvailableInCountry(p, cc));
}

export default function ProductMulti({
  label = "Products",
  value,
  onChange,
  disabled,
  ruleCountries = [],
}: {
  label?: string;
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  /** countries selected on the Rule (from OrgCountriesSelect) */
  ruleCountries?: string[];
}) {
  const [loading, setLoading] = useState(false);
  const [term, setTerm] = useState("");
  const [initial, setInitial] = useState<ProductRow[]>([]);
  const [results, setResults] = useState<ProductRow[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Build a catalog index so we can name things in messages and validate selections
  const catalog = useMemo(() => {
    const map = new Map<string, ProductRow>();
    for (const p of initial) map.set(p.id, p);
    for (const p of results) map.set(p.id, p);
    return map;
  }, [initial, results]);

  // Prefetch a page so the list isn’t empty before searching
  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/products?page=1&pageSize=50&ownedOnly=1`, {
          headers: { accept: "application/json" },
          cache: "no-store",
        });
        const body = await r.json().catch(() => ({}));
        const items: ProductRow[] = (body.products ?? []).map((p: any) => ({
          id: p.id,
          title: p.title ?? p.sku ?? p.id,
          sku: p.sku ?? null,
          allowBackorders: !!p.allowBackorders,
          stockData: p.stockData ?? {},
        }));
        if (mounted) setInitial(items);
      } catch {
        if (mounted) setInitial([]);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Debounced remote search
  useEffect(() => {
    const q = term.trim();
    if (q.length < 3) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=50&ownedOnly=1`,
          { headers: { accept: "application/json" }, cache: "no-store" }
        );
        const body = await r.json().catch(() => ({}));
        const items: ProductRow[] = (body.products ?? []).map((p: any) => ({
          id: p.id,
          title: p.title ?? p.sku ?? p.id,
          sku: p.sku ?? null,
          allowBackorders: !!p.allowBackorders,
          stockData: p.stockData ?? {},
        }));
        setResults(items);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [term]);

  // If rule countries change, drop incompatible already-selected products (like CouponSelect)
  useEffect(() => {
    if (!value.length) return;
    const incompatibleIds: string[] = [];
    for (const id of value) {
      const p = catalog.get(id);
      if (!p) continue; // unknown → don’t judge
      if (!isCompatibleForRule(p, ruleCountries)) incompatibleIds.push(id);
    }
    if (incompatibleIds.length) {
      const incompatibleNames = incompatibleIds
        .map((id) => catalog.get(id)?.title || id)
        .join(", ");
      onChange(value.filter((id) => !incompatibleIds.includes(id)));
      setErrorMsg(
        `Removed product${incompatibleIds.length > 1 ? "s" : ""} not available for ${ruleCountries.join(
          ", "
        )}: ${incompatibleNames}.`
      );
    } else {
      setErrorMsg(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ruleCountries.join(","), catalog.size, value.join(",")]);

  const allToShow = useMemo(() => {
    // Merge initial + results; de-dupe by id
    const m = new Map<string, ProductRow>();
    for (const p of initial) m.set(p.id, p);
    for (const p of results) m.set(p.id, p);
    return Array.from(m.values()).sort((a, b) =>
      a.title.localeCompare(b.title)
    );
  }, [initial, results]);

  const add = (id: string) => {
    const p = catalog.get(id);
    if (!p) {
      // unknown product – just add
      if (!value.includes(id)) onChange([...value, id]);
      return;
    }
    if (!isCompatibleForRule(p, ruleCountries)) {
      const badIn: string[] = [];
      for (const cc of ruleCountries) {
        if (!isAvailableInCountry(p, cc)) badIn.push(cc);
      }
      setErrorMsg(
        `“${p.title}” isn’t available in ${badIn.join(", ")} for this rule.`
      );
      return; // block adding
    }
    setErrorMsg(null);
    if (!value.includes(id)) onChange([...value, id]);
  };

  const remove = (id: string) => {
    setErrorMsg(null);
    onChange(value.filter((v) => v !== id));
  };

  return (
    <div className="grid gap-3">
      <div className="space-y-2">
        <Label>{label}</Label>

        {/* Select with search header, like the Order Create form */}
        <Select
          // keep value empty so it's usable as an "add one" control
          value=""
          onValueChange={(id) => add(id)}
          disabled={disabled || loading}
        >
          <SelectTrigger>
            <SelectValue placeholder={loading ? "Loading…" : "Select or search product"} />
          </SelectTrigger>
          <SelectContent className="w-[520px]">
            {/* Search bar */}
            <div className="p-3 border-b flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Search products (min 3 chars)"
                className="h-8"
              />
            </div>

            <ScrollArea className="max-h-72">
              <SelectGroup>
                <SelectLabel>Products</SelectLabel>
                {allToShow.map((p) => {
                  const compatible = isCompatibleForRule(p, ruleCountries);
                  // Small stock summary per rule country
                  const stockLine =
                    ruleCountries.length === 0
                      ? null
                      : (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {ruleCountries.map((cc) => {
                              const qty = stockForCountry(p, cc);
                              const finite = hasFiniteStock(p);
                              const show = finite ? String(qty) : "∞";
                              const label =
                                !finite
                                  ? "∞"
                                  : qty > 0
                                  ? show
                                  : p.allowBackorders
                                  ? "backorder"
                                  : "0";
                              return (
                                <span key={`${p.id}-${cc}`} className="inline-flex items-center gap-1 mr-2">
                                  <ReactCountryFlag countryCode={cc} svg style={{ width: 14, height: 10 }} />
                                  {label}
                                </span>
                              );
                            })}
                          </span>
                        );

                  return (
                    <SelectItem
                      key={p.id}
                      value={p.id}
                      disabled={!compatible}
                    >
                      <span className={cn("block max-w-[440px] truncate", !compatible && "opacity-60")}>
                        {p.title}
                        {p.sku ? <span className="text-muted-foreground"> — {p.sku}</span> : null}
                        {stockLine}
                        {!compatible && ruleCountries.length > 0 && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider">
                            Not available for current rule
                          </span>
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectGroup>

              {allToShow.length > 0 && <SelectSeparator />}
              {loading && (
                <div className="px-3 py-2 text-sm text-muted-foreground">Searching…</div>
              )}
              {!loading && term && results.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">No matches</div>
              )}
            </ScrollArea>
          </SelectContent>
        </Select>
        {errorMsg ? <p className="text-xs text-destructive">{errorMsg}</p> : null}
        {!ruleCountries.length && (
          <p className="text-xs text-muted-foreground">
            No rule countries selected — any product can be used.
          </p>
        )}
      </div>

      {/* Selected chips */}
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && (
          <span className="text-xs text-muted-foreground">None selected</span>
        )}
        {value.map((id) => {
          const title = catalog.get(id)?.title || id;
          return (
            <Badge key={id} variant="secondary" className="flex items-center gap-2">
              <span className="truncate max-w-[220px]">{title}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-5 px-1"
                onClick={() => remove(id)}
                disabled={disabled}
                aria-label={`Remove ${title}`}
              >
                ×
              </Button>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
