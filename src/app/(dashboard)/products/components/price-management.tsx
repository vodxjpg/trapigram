/* ────────────────────────────────────────────────────────────────
   Cost + Price management table (mobile-friendly)
───────────────────────────────────────────────────────────────── */
"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/* ------------------------------------------------------------------
   Types
------------------------------------------------------------------ */
export interface PriceMap {
  [country: string]: { regular: number; sale: number | null };
}
export interface CostMap {
  [country: string]: number;
}

interface Props {
  title: string;
  countries: string[];
  priceData: PriceMap;
  costData: CostMap;
  onPriceChange: (p: PriceMap) => void;
  onCostChange: (c: CostMap) => void;
}

/* ------------------------------------------------------------------
   Component
------------------------------------------------------------------ */
export function PriceManagement({
  title,
  countries,
  priceData = {},
  costData = {},
  onPriceChange,
  onCostChange,
}: Props) {
  const [open, setOpen] = useState(true);
  const [bulkCost, setBulkCost] = useState<string>("");
  const [bulkRegular, setBulkRegular] = useState<string>("");
  const [bulkSale, setBulkSale] = useState<string>("");
  const [onlyEmpty, setOnlyEmpty] = useState<boolean>(false);

  /* ---------- helpers ---------- */
  const patchPrice = (
    country: string,
    patch: Partial<(typeof priceData)[string]>
  ) =>
    onPriceChange({
      ...priceData,
      [country]: {
        regular: 0,
        sale: null,
        ...(priceData[country] || {}),
        ...patch,
      },
    });

  const patchCost = (country: string, cost: number) =>
    onCostChange({ ...costData, [country]: cost });

    const parsedBulk = useMemo(() => {
    const toNum = (s: string) => {
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    return {
      cost: toNum(bulkCost),
      regular: toNum(bulkRegular),
      sale: bulkSale.trim() === "" ? null : toNum(bulkSale),
    };
  }, [bulkCost, bulkRegular, bulkSale]);

  const applyBulk = () => {
    const nextPrices: PriceMap = { ...priceData };
    const nextCosts: CostMap = { ...costData };

    countries.forEach((c) => {
      // cost
      if (parsedBulk.cost !== null) {
        const should = !onlyEmpty || (onlyEmpty && (!Number.isFinite(nextCosts[c]) || (nextCosts[c] ?? 0) === 0));
        if (should) nextCosts[c] = parsedBulk.cost!;
      }
      // regular price
      if (parsedBulk.regular !== null) {
        const cur = nextPrices[c] || { regular: 0, sale: null };
        const should = !onlyEmpty || (onlyEmpty && (!Number.isFinite(cur.regular) || cur.regular === 0));
        nextPrices[c] = {
          ...cur,
          regular: should ? parsedBulk.regular! : cur.regular,
        };
      }
      // sale price
      if (parsedBulk.sale !== undefined) {
        const cur = nextPrices[c] || { regular: 0, sale: null };
        const should = !onlyEmpty || (onlyEmpty && (cur.sale == null || cur.sale === 0));
        nextPrices[c] = {
          ...cur,
          sale: should ? parsedBulk.sale : cur.sale,
        };
      }
    });

    onPriceChange(nextPrices);
    onCostChange(nextCosts);
  };

  const clearSaleForAll = () => {
    const next: PriceMap = { ...priceData };
    countries.forEach((c) => {
      const cur = next[c] || { regular: 0, sale: null };
      next[c] = { ...cur, sale: null };
    });
    onPriceChange(next);
  };

  /* ---------- render ---------- */
  return (
    <Card>
      <CardHeader
        onClick={() => setOpen((p) => !p)}
        className="cursor-pointer flex items-center justify-between py-3 px-4"
      >
        <CardTitle className="text-base">{title}</CardTitle>
        {open ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </CardHeader>

      {open && (
        <CardContent>
                    {/* Bulk row ---------------------------------------------------- */}
          <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-3">
              <label className="block text-xs mb-1">Bulk Cost (all countries)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 5.00"
                value={bulkCost}
                onChange={(e) => setBulkCost(e.target.value)}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs mb-1">Bulk Regular (all countries)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 9.99"
                value={bulkRegular}
                onChange={(e) => setBulkRegular(e.target.value)}
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs mb-1">Bulk Sale (all countries, optional)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="leave empty to keep"
                value={bulkSale}
                onChange={(e) => setBulkSale(e.target.value)}
              />
            </div>
            <div className="md:col-span-3 flex items-end">
              <div className="flex items-center gap-2">
                <Switch
                  id="only-empty-toggle"
                  checked={onlyEmpty}
                  onCheckedChange={setOnlyEmpty}
                />
                <label htmlFor="only-empty-toggle" className="text-xs select-none">
                  Only fill empty fields
                </label>
              </div>
            </div>
            <div className="md:col-span-12 flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={applyBulk}
                disabled={
                  parsedBulk.cost === null &&
                  parsedBulk.regular === null &&
                  parsedBulk.sale === undefined
                }
              >
                Apply to all countries
              </Button>
              <Button type="button" variant="outline" onClick={clearSaleForAll}>
                Clear sale for all
              </Button>
            </div>
          </div>
          {/* horizontal scroll on small screens */}
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-[120px] text-right">Cost</TableHead>
                  <TableHead className="w-[120px] text-right">
                    Regular price
                  </TableHead>
                  <TableHead className="w-[120px] text-right">
                    Sale price (opt.)
                  </TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {countries.map((c) => (
                  <TableRow key={c}>
                    <TableCell>{c}</TableCell>

                    {/* Cost */}
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={costData[c] ?? 0}
                        onFocus={(e) => {
                          // select current value so typing replaces it
                          e.currentTarget.select();
                        }}
                        onChange={(e) =>
                          patchCost(c, Number.parseFloat(e.target.value) || 0)
                        }
                      />
                    </TableCell>

                    {/* Regular price */}
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceData[c]?.regular ?? 0}
                        onFocus={(e) => {
                          e.currentTarget.select();
                        }}
                        onChange={(e) =>
                          patchPrice(c, {
                            regular: Number.parseFloat(e.target.value) || 0,
                          })
                        }
                      />
                    </TableCell>

                    {/* Sale price */}
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={priceData[c]?.sale ?? ""}
                        onFocus={(e) => {
                          e.currentTarget.select();
                        }}
                        onChange={(e) =>
                          patchPrice(c, {
                            sale:
                              e.target.value.trim() === ""
                                ? null
                                : Number.parseFloat(e.target.value) || 0,
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
