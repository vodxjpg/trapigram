/* ────────────────────────────────────────────────────────────────
   src/app/(dashboard)/affiliates/products/components/level-points-management.tsx
   (FULL FILE)
───────────────────────────────────────────────────────────────── */
"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PointsManagement } from "./points-management";
import { CountryPts, PointsByLvl } from "@/lib/affiliatePoints";

interface Props {
  title   : string;
  countries: string[];
  levels  : { id: string; name: string }[];
  value   : PointsByLvl;
  onChange: (m: PointsByLvl) => void;

  /* NEW — cost handling */
  costData    : Record<string, number>;
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

  /* ensure object exists for current tab */
  useEffect(() => {
    if (!value[active]) {
      const blank = Object.fromEntries(
        countries.map((c) => [c, { regular: 0, sale: null }]),
      ) as Record<string, CountryPts>;
      onChange({ ...value, [active]: blank });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, countries]);

  const updatePoints = (m: Record<string, CountryPts>) =>
    onChange({ ...value, [active]: m });

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

      {value[active] && (
        <PointsManagement
          title={`Prices for ${
            active === "default"
              ? "all levels"
              : levels.find((x) => x.id === active)?.name
          }`}
          countries={countries}
          /* fixed prop names + cost support */
          pointsData={value[active]}
          onPointsChange={updatePoints}
          costData={costData}
          onCostChange={onCostChange}
        />
      )}
    </Card>
  );
}
