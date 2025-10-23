/* ────────────────────────────────────────────────────────────────
   src/app/(dashboard)/affiliates/products/components/level-points-management.tsx
───────────────────────────────────────────────────────────────── */
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PointsManagement } from "./points-management";

/* Local types (remove the broken import from "@/lib/affiliatePoints") */
export type CountryPts = { regular: number; sale: number | null };
export type PointsByLvl = Record<string, Record<string, CountryPts>>;

interface Props {
  title: string;
  countries: string[];
  levels: { id: string; name: string }[];
  value: PointsByLvl | undefined;       // ← allow undefined safely
  onChange: (m: PointsByLvl) => void;

  /* cost */
  costData: Record<string, number> | undefined;
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

  // Safe fallbacks so we never spread undefined
  const safeValue: PointsByLvl = useMemo(
    () => value ?? ({ default: {} } as PointsByLvl),
    [value]
  );
  const safeCost: Record<string, number> = useMemo(
    () => costData ?? {},
    [costData]
  );

  // Ensure the current tab exists in the map
  useEffect(() => {
    if (!safeValue[active]) {
      const blank = Object.fromEntries(
        countries.map((c) => [c, { regular: 0, sale: null }])
      ) as Record<string, CountryPts>;
      onChange({ ...safeValue, [active]: blank });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, countries, safeValue]);

  const updatePoints = (m: Record<string, CountryPts>) =>
    onChange({ ...safeValue, [active]: m });

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

      {safeValue[active] && (
        <PointsManagement
          title={`Prices for ${
            active === "default"
              ? "all levels"
              : levels.find((x) => x.id === active)?.name
          }`}
          countries={countries}
          pointsData={safeValue[active]}
          onPointsChange={updatePoints}
          costData={safeCost}
          onCostChange={onCostChange}
        />
      )}
    </Card>
  );
}
