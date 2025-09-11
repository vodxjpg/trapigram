
"use client";

import { useEffect, useMemo, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ReactCountryFlag from "react-country-flag";
import { cn } from "@/lib/utils";

type Coupon = {
  id: string;
  name: string;
  code: string;
  countries: string[]; // parsed on API
};

function isCouponCompatible(couponCountries: string[], ruleCountries: string[]) {
  if (!ruleCountries?.length) return true; // no restriction
  if (!couponCountries?.length) return false;
  // require coupon.countries ⊇ rule.countries
  return ruleCountries.every((c) => couponCountries.includes(c));
}

export default function CouponSelect({
  value,
  onChange,
  ruleCountries,
  disabled,
  error,
  setError,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  ruleCountries: string[];
  disabled?: boolean;
  error?: string | null;
  setError?: (msg: string | null) => void;
}) {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    // load many at once (paginate high)
    fetch(`/api/coupons?page=1&pageSize=1000`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to fetch coupons"))))
      .then((data) => {
        if (!mounted) return;
        const list: Coupon[] = (data?.coupons || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          countries: Array.isArray(c.countries)
            ? c.countries
            : JSON.parse(c.countries || "[]"),
        }));
        setCoupons(list);
      })
      .catch(() => setCoupons([]))
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  // if countries change and current coupon becomes incompatible → clear & show error
  useEffect(() => {
    if (!value) return;
    const current = coupons.find((c) => c.id === value);
    if (!current) return;
    if (!isCouponCompatible(current.countries, ruleCountries)) {
      onChange(null);
      setError?.(
        `Selected coupon isn’t valid for ${ruleCountries.join(
          ", "
        )}. Please pick a compatible coupon.`
      );
    } else {
      setError?.(null);
    }
  }, [ruleCountries.join(","), coupons.map((c) => c.id).join(","), value]); // eslint-disable-line

  const items = useMemo(() => {
    return coupons.map((c) => {
      const compatible = isCouponCompatible(c.countries, ruleCountries);
      return { ...c, compatible };
    });
  }, [coupons, ruleCountries]);

  return (
    <div className="space-y-2">
      <Label>Coupon</Label>
      <Select
        disabled={disabled || loading}
        value={value ?? ""}
        onValueChange={(id) => {
          const chosen = coupons.find((c) => c.id === id);
          if (chosen && !isCouponCompatible(chosen.countries, ruleCountries)) {
            setError?.(
              `Coupon “${chosen.name}” isn’t valid for ${ruleCountries.join(
                ", "
              )}.`
            );
            return; // cannot select incompatible (items are also disabled)
          }
          setError?.(null);
          onChange(id || null);
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={loading ? "Loading…" : "Select a coupon"} />
        </SelectTrigger>
        <SelectContent>
          {items.map((c) => (
            <SelectItem key={c.id} value={c.id} disabled={!c.compatible}>
              <div className="flex flex-col">
                <span className={cn(!c.compatible && "opacity-60")}>
                  {c.name} <span className="text-muted-foreground">({c.code})</span>
                </span>
                <span className="text-xs text-muted-foreground flex gap-1 flex-wrap">
                  {c.countries.map((cc) => (
                    <span key={cc} className="inline-flex items-center gap-1">
                      <ReactCountryFlag countryCode={cc} svg style={{ width: 14, height: 10 }} />
                      {cc}
                    </span>
                  ))}
                  {!c.countries.length && <em>No countries</em>}
                  {!c.compatible && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider">Not valid for current rule</span>
                  )}
                </span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {!ruleCountries.length && (
        <p className="text-xs text-muted-foreground">
          No rule countries selected — any coupon can be used.
        </p>
      )}
    </div>
  );
}
