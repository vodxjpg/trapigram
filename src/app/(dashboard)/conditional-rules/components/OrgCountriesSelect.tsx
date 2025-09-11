"use client";

import { useEffect, useMemo, useState } from "react";
import Select from "react-select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import ReactCountryFlag from "react-country-flag";
import countriesLib from "i18n-iso-countries";
import enLocale from "i18n-iso-countries/langs/en.json";

countriesLib.registerLocale(enLocale);

type Option = { value: string; label: string };

export default function OrgCountriesSelect({
  value,
  onChange,
  disabled,
  label = "Countries",
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch("/api/organizations/countries", {
      headers: {
        // mirror the coupons form pattern
        "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "",
      },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Failed to fetch countries"))))
      .then((data) => {
        if (!mounted) return;
        const list: string[] = Array.isArray(data.countries)
          ? data.countries
          : JSON.parse(data.countries || "[]");
        const opts = list
          .filter(Boolean)
          .map((c) => ({
            value: c,
            label: countriesLib.getName(c, "en") || c,
          }))
          .sort((a, b) => a.label.localeCompare(b.label));
        setOptions(opts);
      })
      .catch(() => {
        if (mounted) setOptions([]);
      })
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, []);

  const selected = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value]
  );

  const selectAll = () => onChange(options.map((o) => o.value));
  const clearAll = () => onChange([]);

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={selectAll} disabled={disabled || loading || options.length === 0}>
          Select all
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={clearAll} disabled={disabled || value.length === 0}>
          Clear
        </Button>
      </div>
      <Select
        isMulti
        isDisabled={disabled || loading}
        options={options}
        value={selected}
        placeholder={loading ? "Loading…" : "Select country(s)"}
        onChange={(opts: any) => onChange((opts || []).map((o: Option) => o.value))}
        formatOptionLabel={(o: any) => (
          <div className="flex items-center gap-2">
            <ReactCountryFlag countryCode={o.value} svg style={{ width: 18, height: 12 }} />
            <span>{o.label}</span>
          </div>
        )}
        classNamePrefix="react-select"
      />
      <p className="text-xs text-muted-foreground">Only countries your organization sells to are listed.</p>
    </div>
  );
}
