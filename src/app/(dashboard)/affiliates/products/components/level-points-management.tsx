"use client";

import { useEffect, useState } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { PointsManagement } from "./points-management";
import { CountryPts, PointsByLvl } from "@/lib/affiliatePoints";

interface Props {
  countries: string[];
  levels   : { id: string; name: string }[];  // from /api/affiliate/levels
  value    : PointsByLvl;
  onChange : (val: PointsByLvl) => void;
  title    : string;
}

/** Renders a selector (default + each level) and reuses
    the existing country‑table for the active level       */
export function LevelPointsManagement({ countries, levels, value, onChange, title }: Props) {
  const [active, setActive] = useState<string>("default");

  /* always ensure object exists */
  useEffect(() => {
    if (!value[active])
      onChange({ ...value, [active]: Object.fromEntries(countries.map(c => [c, { regular: 0, sale: null }])) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, countries]);

  const update = (map: Record<string, CountryPts>) =>
    onChange({ ...value, [active]: map });

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
            {levels.map(l => (
              <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* existing table UI reused */}
      {value[active] && (
        <PointsManagement
          title={`Prices for ${active === "default" ? "all levels" : levels.find(x=>x.id===active)?.name}`}
          countries={countries}
          pointsData={value[active]}
          onChange={update}
        />
      )}
    </Card>
  );
}
