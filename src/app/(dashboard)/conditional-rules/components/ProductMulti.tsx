"use client";

import { useEffect, useMemo, useState } from "react";
import Select, { GroupBase } from "react-select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Search } from "lucide-react";

type ProductOpt = { value: string; label: string; meta: { price?: number; isAffiliate?: boolean } };
type Group = GroupBase<ProductOpt>;

const DEBOUNCE_MS = 400;

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
  const [affProducts, setAffProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [term, setTerm] = useState("");
  const [remote, setRemote] = useState<{ shop: any[]; aff: any[] }>({ shop: [], aff: [] });
  const [searching, setSearching] = useState(false);

  // Load all categories → map {id -> name}
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/product-categories?all=1").catch(() => null);
        if (res && res.ok) {
          const data = await res.json();
          const rows: Array<{ id: string; name: string }> = data.categories ?? data.items ?? [];
          setCategoryMap(Object.fromEntries(rows.map((c) => [c.id, c.name])));
        } else {
          // fallback: best-effort pagination
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
          if (acc.length) {
            setCategoryMap(Object.fromEntries(acc.map((c) => [c.id, c.name])));
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Load product catalogs (shop + affiliate)
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [shopRes, affRes] = await Promise.all([
          fetch("/api/products?page=1&pageSize=1000"),
          fetch("/api/affiliate/products?limit=1000"),
        ]);
        if (!shopRes.ok || !affRes.ok) throw new Error("Failed products load");
        const shop = (await shopRes.json()).products || [];
        const aff = (await affRes.json()).products || [];
        setShopProducts(shop);
        setAffProducts(aff);
      } catch {
        setShopProducts([]);
        setAffProducts([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Debounced remote search (augment the list)
  useEffect(() => {
    const q = term.trim();
    if (q.length < 3) {
      setRemote({ shop: [], aff: [] });
      setSearching(false);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const [s, a] = await Promise.all([
          fetch(`/api/products?search=${encodeURIComponent(q)}&page=1&pageSize=50`)
            .then((r) => (r.ok ? r.json() : { products: [] }))
            .then((d) => d.products || []),
          fetch(`/api/affiliate/products?search=${encodeURIComponent(q)}&limit=50`)
            .then((r) => (r.ok ? r.json() : { products: [] }))
            .then((d) => d.products || []),
        ]);
        setRemote({ shop: s, aff: a });
      } catch {
        setRemote({ shop: [], aff: [] });
      } finally {
        setSearching(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // Helpers
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
        meta: { price, isAffiliate: false },
      });
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, opts]) => ({ label, options: opts.sort((x, y) => x.label.localeCompare(y.label)) }));
  };

  const mapAff = (arr: any[]): Group => {
    const opts: ProductOpt[] = arr.map((a: any) => {
      const price = Object.values(a.pointsPrice ?? {})[0] ?? 0;
      return {
        value: a.id,
        label: `${a.title} — ${price} pts`,
        meta: { price, isAffiliate: true },
      };
    });
    return { label: "Affiliate", options: opts.sort((x, y) => x.label.localeCompare(y.label)) };
  };

  // Base groups (local)
  const baseGroups: Group[] = useMemo(() => {
    const groups: Group[] = [];
    groups.push(...groupShop(shopProducts));
    if (affProducts?.length) groups.push(mapAff(affProducts));
    return groups;
  }, [shopProducts, affProducts, categoryMap]);

  // Merge in remote (exclude already-present ids)
  const mergedGroups: Group[] = useMemo(() => {
    const present = new Set<string>(
      baseGroups.flatMap((g) => g.options.map((o) => o.value)),
    );

    const extraShop = groupShop(
      (remote.shop || []).filter((p: any) => !present.has(p.id)),
    );
    const extraAffArr = (remote.aff || []).filter((p: any) => !present.has(p.id));
    const extraAff = extraAffArr.length ? [mapAff(extraAffArr)] : [];

    return [...baseGroups, ...extraShop, ...extraAff];
  }, [baseGroups, remote]);

  // Current selection objects
  const selected = useMemo(() => {
    const all = new Map<string, ProductOpt>();
    for (const g of mergedGroups) for (const o of g.options) all.set(o.value, o);
    return value.map((id) => all.get(id)).filter(Boolean) as ProductOpt[];
  }, [value, mergedGroups]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>

      {/* Small search bar on top (client + remote debounce) */}
      <div className="p-2 border rounded-md flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search products (min 3 chars for remote)"
          className="h-8"
        />
      </div>

      <Select<ProductOpt, true, Group>
        isMulti
        isDisabled={disabled || loading}
        options={mergedGroups}
        value={selected}
        onChange={(opts) => onChange(opts.map((o) => o.value))}
        closeMenuOnSelect={false}
        placeholder={loading ? "Loading…" : "Select products"}
        classNamePrefix="rules-product-select"
      />

      <div className="text-xs text-muted-foreground">
        {searching ? "Searching…" : `${selected.length} selected`}
      </div>
      <Separator />
    </div>
  );
}
