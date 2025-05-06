// src/app/(dashboard)/affiliate-products/components/level-requirement-select.tsx
"use client";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormLabel, FormDescription } from "@/components/ui/form";

interface Level {
  id: string;
  name: string;
  requiredPoints: number;
}

interface Props {
  value: string | null;                         // current minLevelId
  onChange: (id: string | null) => void;
  inline?: boolean;                             // for variation card
}




export function LevelRequirementSelect({ value, onChange, inline=false }: Props) {
  const [levels, setLevels] = useState<Level[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/affiliate/levels");
        const { levels: lv } = await r.json();
        setLevels(lv);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if(loading) return <Loader2 className="h-4 w-4 animate-spin" />;

  return (
    <div className={inline ? "space-y-2" : "mt-4"}>
      {!inline && <FormLabel>Minimum affiliate level</FormLabel>}
      <Select value={value ?? "none"} onValueChange={val => onChange(val === "none" ? null : val)}>
        <SelectTrigger>
          <SelectValue placeholder="No minimum (all affiliates)" />
        </SelectTrigger>
        <SelectContent>
        <SelectItem key="none" value="none">No minimum</SelectItem>
          {levels.map(l=>(
            <SelectItem key={l.id} value={l.id}>
              {l.name} (≥{l.requiredPoints} pts)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!inline && (
        <FormDescription className="text-xs">
          If set, only affiliates at / above this level can purchase.
        </FormDescription>
      )}
    </div>
  );
}
