/* ────────────────────────────────────────────────────────────────
   src/app/(dashboard)/affiliates/products/components/points-management.tsx
───────────────────────────────────────────────────────────────── */
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface CountryPoints {
  regular: number;
  sale: number | null;
}
export interface PointsMap {
  [country: string]: CountryPoints;
}
export interface CostMap {
  [country: string]: number;
}

interface Props {
  title: string;
  countries: string[];
  pointsData: PointsMap;
  onPointsChange: (p: PointsMap) => void;
  costData: CostMap;
  onCostChange: (c: CostMap) => void;
}

export function PointsManagement({
  title,
  countries,
  pointsData = {},
  onPointsChange,
  costData = {},
  onCostChange,
}: Props) {
  const [open, setOpen] = useState(true);

  const patchPoints = (country: string, patch: Partial<CountryPoints>) => {
    const prev = pointsData[country] ?? { regular: 0, sale: null };
    onPointsChange({
      ...pointsData,
      [country]: { ...prev, ...patch },
    });
  };

  const patchCost = (country: string, cost: number) =>
    onCostChange({ ...costData, [country]: cost });

  return (
    <Card>
      <CardHeader
        onClick={() => setOpen((p) => !p)}
        className="cursor-pointer flex items-center justify-between py-3 px-4"
      >
        <CardTitle className="text-base">{title}</CardTitle>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CardHeader>

      {open && (
        <CardContent>
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-[120px] text-right">Cost</TableHead>
                  <TableHead className="w-[120px] text-right">Regular pts</TableHead>
                  <TableHead className="w-[120px] text-right">Sale pts&nbsp;(opt.)</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {countries.map((c) => (
                  <TableRow key={c}>
                    <TableCell>{c}</TableCell>

                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={costData[c] ?? 0}
                        onChange={(e) => patchCost(c, Number.parseFloat(e.target.value) || 0)}
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={pointsData[c]?.regular ?? 0}
                        onChange={(e) =>
                          patchPoints(c, { regular: Number.parseInt(e.target.value) || 0 })
                        }
                      />
                    </TableCell>

                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        value={pointsData[c]?.sale ?? ""}
                        onChange={(e) =>
                          patchPoints(c, {
                            sale:
                              e.target.value.trim() === ""
                                ? null
                                : Number.parseInt(e.target.value) || 0,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
