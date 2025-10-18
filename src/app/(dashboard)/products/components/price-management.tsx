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
  [country: string]: { regular?: number; sale?: number | null };
}
export interface CostMap {
  [country: string]: number | undefined;
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
  const setPriceField = (country: string, patch: Partial<NonNullable<PriceMap[string]>>) => {
    const next: PriceMap = { ...priceData };
    const cur = next[country] ?? {};
    next[country] = { ...cur, ...patch };
    // If both fields are effectively empty, drop the country entry to avoid phantom zeros
    const n = next[country];
    const noRegular = n.regular === undefined || Number.isNaN(n.regular as any);
    const noSale = n.sale === undefined || n.sale === null || Number.isNaN(n.sale as any);
    if (noRegular && noSale) {
      delete next[country];
    }
    onPriceChange(next);
  };

  const setCostField = (country: string, raw: string) => {
    if (raw.trim() === "") {
      const next: CostMap = { ...costData };
      delete next[country];
      onCostChange(next);
      return;
    }
    const n = Number.parseFloat(raw);
    const next: CostMap = { ...costData, [country]: Number.isFinite(n) ? n : undefined };
    onCostChange(next);
  };

  const parsedBulk = useMemo(() => {
    const toNum = (s: string) => {
      if (s.trim() === "") return null;
      const n = Number.parseFloat(s);
      return Number.isFinite(n) ? n : null;
    };
    return {
      cost: toNum(bulkCost),
      regular: toNum(bulkRegular),
      // empty string means “leave as is”; use `undefined` to represent that
      sale: bulkSale.trim() === "" ? undefined : toNum(bulkSale),
    };
  }, [bulkCost, bulkRegular, bulkSale]);

  const isEmptyNumber = (v: unknown) =>
    v === undefined || v === null || Number.isNaN(v as any);

  const applyBulk = () => {
    const nextPrices: PriceMap = { ...priceData };
    const nextCosts: CostMap = { ...costData };

    countries.forEach((c) => {
      // cost
      if (parsedBulk.cost !== null) {
        const should =
          !onlyEmpty || (onlyEmpty && isEmptyNumber(nextCosts[c]));
        if (should) nextCosts[c] = parsedBulk.cost!;
      }
      // regular price
      if (parsedBulk.regular !== null) {
        const cur = nextPrices[c] ?? {};
        const should =
          !onlyEmpty || (onlyEmpty && isEmptyNumber(cur.regular));
        nextPrices[c] = { ...cur, regular: should ? parsedBulk.regular! : cur.regular };
      }
      // sale price (undefined → leave, null → clear)
      if (parsedBulk.sale !== undefined) {
        const cur = nextPrices[c] ?? {};
        const should =
          !onlyEmpty || (onlyEmpty && (cur.sale == null || isEmptyNumber(cur.sale)));
        nextPrices[c] = { ...cur, sale: should ? parsedBulk.sale : cur.sale };
      }

      // cleanup empty entries
      const entry = nextPrices[c];
      if (entry) {
        const noRegular = isEmptyNumber(entry.regular);
        const noSale = entry.sale === undefined || entry.sale === null || isEmptyNumber(entry.sale);
        if (noRegular && noSale) delete nextPrices[c];
      }
    });

    onPriceChange(nextPrices);
    onCostChange(nextCosts);
  };

  const clearSaleForAll = () => {
    const next: PriceMap = { ...priceData };
    countries.forEach((c) => {
      const cur = next[c] ?? {};
      next[c] = { ...cur, sale: null };
      // if regular missing too, delete entirely
      const n = next[c];
      if (isEmptyNumber(n.regular) && (n.sale === null || n.sale === undefined)) {
        delete next[c];
      }
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
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                Clear all sale prices
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
                  <TableHead className="w-[120px] text-right">Regular price</TableHead>
                  <TableHead className="w-[120px] text-right">Sale price (opt.)</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                {countries.map((c) => {
                  const costVal = costData[c];
                  const regVal = priceData[c]?.regular;
                  const saleVal = priceData[c]?.sale;

                  return (
                    <TableRow key={c}>
                      <TableCell>{c}</TableCell>

                      {/* Cost */}
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          // show empty string instead of 0/undefined so users don't see a leading 0
                          value={costVal ?? ""}
                          onChange={(e) => setCostField(c, e.target.value)}
                          placeholder="0.00"
                        />
                      </TableCell>

                      {/* Regular price */}
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={regVal ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw.trim() === "") {
                              // remove regular (keep sale if any)
                              setPriceField(c, { regular: undefined });
                              return;
                            }
                            const n = Number.parseFloat(raw);
                            setPriceField(c, { regular: Number.isFinite(n) ? n : undefined });
                          }}
                          placeholder="0.00"
                        />
                      </TableCell>

                      {/* Sale price */}
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={saleVal ?? ""}
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw.trim() === "") {
                              // empty input means “no sale”
                              setPriceField(c, { sale: null });
                              return;
                            }
                            const n = Number.parseFloat(raw);
                            setPriceField(c, { sale: Number.isFinite(n) ? n : null });
                          }}
                          placeholder="0.00"
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
