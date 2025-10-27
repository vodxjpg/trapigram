// src/app/(dashboard)/affiliates/products/components/level-points-management.tsx
// app/(dashboard)/affiliates/products/components/level-points-management.tsx
"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PointsManagement } from "./points-management";

/* local types (avoid missing module) */
type CountryPts = { regular: number; sale: number | null };
export type PointsByLvl = Record<string, Record<string, CountryPts>>;

interface Props {
  title: string;
  countries: string[];
  levels: { id: string; name: string }[];
  value: PointsByLvl;
  onChange: (m: PointsByLvl) => void;
  costData: Record<string, number>;
  onCostChange: (m: Record<string, number>) => void;
}

export function LevelPointsManagement({
  title,
  countries,
  levels,
  value,
  onChange,
  costData,
  onCostChange,
}: Props) {
  const [active, setActive] = useState<string>("default");

  /* ensure object exists for current tab, without clobbering existing user edits */
  useEffect(() => {
    const current = value?.[active];
    // Always have a base with all countries
    const base = Object.fromEntries(
      countries.map((c) => [c, { regular: 0, sale: null } as CountryPts]),
    ) as Record<string, CountryPts>;

    if (!current) {
      onChange({ ...(value || {}), [active]: base });
      return;
    }

    // Patch only missing countries; keep existing values intact
    const patched: Record<string, CountryPts> = { ...current };
    let changed = false;
    countries.forEach((c) => {
      if (patched[c] == null) {
        patched[c] = { regular: 0, sale: null };
        changed = true;
      }
    });

    if (changed) {
      onChange({ ...(value || {}), [active]: patched });
    }
    // include value so we don't apply stale merges that drop earlier edits
  }, [active, countries, value, onChange]);

  const updatePoints = (m: Record<string, CountryPts>) =>
    onChange({ ...(value || {}), [active]: m });

  const safeValue = value?.[active] ?? ({} as Record<string, CountryPts>);

  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center gap-4">
        <h3 className="font-medium">{title}</h3>
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger className="w-[220px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">All levels (default)</SelectItem>
            {levels.map((l) => (
              <SelectItem key={l.id} value={l.id}>
                {l.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <PointsManagement
        title={`Prices for ${
          active === "default" ? "all levels" : levels.find((x) => x.id === active)?.name ?? ""
        }`}
        countries={countries}
        pointsData={safeValue}
        onPointsChange={updatePoints}
        costData={costData}
        onCostChange={onCostChange}
      />
    </Card>
  );
}
