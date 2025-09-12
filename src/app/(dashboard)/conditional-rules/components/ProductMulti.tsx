// src/app/(dashboard)/conditional-rules/components/ProductMulti.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Select, { GroupBase } from "react-select";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

type ProductOpt = { value: string; label: string; meta: { price?: number } };
type Group = GroupBase<ProductOpt>;

export default function ProductMulti({
  value,
  onChange,
  disabled,
  label = "Products",
}: {
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [shopProducts, setShopProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Load categories
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/product-categories?all=1").catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const rows: Array<{ id: string; name: string }> = data.categories ?? data.items ?? [];
          setCategoryMap(Object.fromEntries(rows.map((c) => [c.id, c.name])));
        } else {
          // best-effort fallback
          let page = 1;
          const pageSize = 200;
          const acc: Array<{ id: string; name: string }> = [];
          // eslint-disable-next-line no-constant-condition
          while (true) {
            const r = await fetch(`/api/product-categories?page=${page}&pageSize=${pageSize}`).catch(() => null);
            if (!r || !r.ok) break;
            const data = await r.json().catch(() => ({}));
            const rows = Array.isArray(data.categories) ? data.categories : [];
            acc.push(...rows.map((c: any) => ({ id: c.id, name: c.name })));
            const totalPages = Number(data.totalPages || 1);
            if (page >= totalPages) break;
            page += 1;
          }
          if (acc.length) setCategoryMap(Object.fromEntries(acc.map((c) => [c.id, c.name])));
        }
      } catch {}
    })();
  }, []);

  // Load shop products (no affiliate)
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/products?page=1&pageSize=1000");
        const data = r.ok ? await r.json() : { products: [] };
        setShopProducts(data.products || []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const catLabel = (id?: string) => (id ? categoryMap[id] || id : "Uncategorized");

  const groupShop = (arr: any[]): Group[] => {
    const buckets: Record<string, ProductOpt[]> = {};
    for (const p of arr) {
      const firstCat = Array.isArray(p.categories) ? p.categories[0] : undefined;
      const label = catLabel(firstCat);
      const price = Object.values(p.salePrice ?? p.regularPrice ?? {})[0] ?? 0;
      (buckets[label] ||= []).push({
        value: p.id,
        label: `${p.title} — ${price}`,
        meta: { price },
      });
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, opts]) => ({ label, options: opts.sort((x, y) => x.label.localeCompare(y.label)) }));
  };

  // Base groups (local)
  const groups: Group[] = useMemo(() => groupShop(shopProducts), [shopProducts, categoryMap]);

  // Current selection objects
  const selected = useMemo(() => {
    const all = new Map<string, ProductOpt>();
    for (const g of groups) for (const o of g.options) all.set(o.value, o);
    return value.map((id) => all.get(id)).filter(Boolean) as ProductOpt[];
  }, [value, groups]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      <Select<ProductOpt, true, Group>
        isMulti
        isDisabled={disabled || loading}
        options={groups}
        value={selected}
        onChange={(opts) => onChange(opts.map((o) => o.value))}
        closeMenuOnSelect={false}
        placeholder={loading ? "Loading…" : "Select products"}
        classNamePrefix="rules-product-select"
      />

      <div className="text-xs text-muted-foreground">
        {`${selected.length} selected`}
      </div>
      <Separator />
    </div>
  );
}
