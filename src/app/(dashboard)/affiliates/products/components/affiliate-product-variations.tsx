/* ------------------------------------------------------------------
   src/app/(dashboard)/affiliates/products/components/affiliate-product-variations.tsx
------------------------------------------------------------------- */
"use client";
import { useState, useEffect } from "react";
import { v4 as uuidv4 } from "uuid";
import { Plus, Trash, Edit, Save, X, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormLabel } from "@/components/ui/form";

import { CostManagement } from "@/app/(dashboard)/products/components/cost-management";
import { LevelRequirementSelect } from "./level-requirement-select";
import { LevelPointsManagement } from "./level-points-management";
import type { Attribute, Variation, Warehouse } from "@/types/product";

/* helpers to create blank maps */
const blankPtsFor = (
  countries: string[],
  levels: { id: string; name: string }[],
): Record<string, Record<string, { regular: number; sale: number | null }>> => {
  const base = countries.reduce(
    (o, c) => ((o[c] = { regular: 0, sale: null }), o),
    {} as Record<string, { regular: number; sale: number | null }>,
  );
  const out: Record<string, typeof base> = { default: { ...base } };
  levels.forEach((l) => (out[l.id] = { ...base }));
  return out;
};
const blankCostFor = (countries: string[]): Record<string, number> =>
  countries.reduce((o, c) => ((o[c] = 0), o), {} as Record<string, number>);

/* local types */
type PointsByLvl = Record<string, Record<string, { regular: number; sale: number | null }>>;
type CostMap = Record<string, number>;

/**
 * Variation from your shared type likely requires `regularPrice` and `salePrice`.
 * Our extended type adds affiliate-specific maps.
 */
interface VariationExt extends Variation {
  prices: PointsByLvl;
  cost: CostMap;
  minLevelId: string | null;
  stock: Record<string, Record<string, number>>;
}

interface Props {
  attributes: Attribute[];
  variations: VariationExt[];
  onVariationsChange: React.Dispatch<React.SetStateAction<VariationExt[]>>;
  warehouses: Warehouse[];
  countries: string[];
  levels: { id: string; name: string }[];
}

/* image uploader */
function VariationImagePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [preview, setPreview] = useState<string | null>(value);
  const inputId = `var-img-${uuidv4()}`;
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const { filePath } = await fetch("/api/upload", { method: "POST", body: fd }).then((r) =>
      r.json(),
    );
    setPreview(filePath);
    onChange(filePath);
  };
  return (
    <>
      {preview ? (
        <div className="relative w-full h-40 rounded-md overflow-hidden mb-2">
          <img src={preview} alt="Variation" className="object-cover w-full h-full" />
        </div>
      ) : (
        <div className="w-full h-40 border border-dashed rounded-md flex items-center justify-center mb-2">
          <span className="text-xs text-muted-foreground">No image</span>
        </div>
      )}
      <input type="file" accept="image/*" id={inputId} className="hidden" onChange={handleUpload} />
      <Button
        variant="outline"
        type="button"
        onClick={() => document.getElementById(inputId)?.click()}
        className="w-full"
      >
        {preview ? "Change Image" : "Upload Image"}
      </Button>
    </>
  );
}

export function AffiliateProductVariations({
  attributes,
  variations,
  onVariationsChange,
  warehouses,
  countries,
  levels,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [skuDraft, setSkuDraft] = useState("");

  /* ensure each variation has full nested maps */
  useEffect(() => {
    if (!countries.length || !warehouses.length || !levels.length) return;
    onVariationsChange((cur) =>
      cur.map((v) => {
        let changed = false;

        // ensure prices map
        const prices: PointsByLvl = { ...v.prices };
        [...Object.keys(prices), ...levels.map((l) => l.id), "default"].forEach((lvl) => {
          if (!prices[lvl]) {
            prices[lvl] = { ...blankPtsFor(countries, levels)[lvl] };
            changed = true;
          }
          countries.forEach((c) => {
            if (prices[lvl][c] === undefined) {
              prices[lvl][c] = { regular: 0, sale: null };
              changed = true;
            }
          });
        });

        // ensure cost map
        const cost: CostMap = { ...v.cost };
        countries.forEach((c) => {
          if (cost[c] === undefined) {
            cost[c] = 0;
            changed = true;
          }
        });

        // ensure stock map
        const stock: Record<string, Record<string, number>> = { ...v.stock };
        warehouses.forEach((w) => {
          if (!stock[w.id]) {
            stock[w.id] = {};
            changed = true;
          }
          w.countries.forEach((c) => {
            if (stock[w.id][c] === undefined) {
              stock[w.id][c] = 0;
              changed = true;
            }
          });
        });

        // ✅ ensure regularPrice / salePrice maps
        const regularPrice: Record<string, number> = { ...(v as any).regularPrice };
        const salePrice: Record<string, number | null> = { ...(v as any).salePrice };
        countries.forEach((c) => {
          if (regularPrice?.[c] === undefined) {
            (regularPrice as any)[c] = 0;
            changed = true;
          }
          if (salePrice?.[c] === undefined) {
            (salePrice as any)[c] = null;
            changed = true;
          }
        });

        return changed
          ? ({ ...v, prices, cost, stock, regularPrice, salePrice } as VariationExt)
          : v;
      }),
    );
  }, [countries, warehouses, levels, onVariationsChange]);


  /* helpers */
  const label = (aid: string, tid: string) => {
    const a = attributes.find((x) => x.id === aid);
    const t = a?.terms.find((y) => y.id === tid);
    return a && t ? `${a.name}: ${t.name}` : "";
  };
  const toggle = (id: string) => setExpandedId((p) => (p === id ? null : id));

  /* updaters */
  const updatePoints = (vid: string, map: PointsByLvl) =>
    onVariationsChange((cur) => cur.map((v) => (v.id === vid ? { ...v, prices: map } : v)));
  const updateCost = (vid: string, map: CostMap) =>
    onVariationsChange((cur) => cur.map((v) => (v.id === vid ? { ...v, cost: map } : v)));
  const updateStock = (vid: string, wid: string, c: string, qty: number) =>
    onVariationsChange((cur) =>
      cur.map((v) =>
        v.id === vid ? { ...v, stock: { ...v.stock, [wid]: { ...v.stock[wid], [c]: qty } } } : v,
      ),
    );

  /* SKU editing */
  const startEditSku = (v: VariationExt) => {
    setEditingId(v.id);
    setSkuDraft(v.sku);
    setExpandedId(v.id);
  };
  const saveSku = () => {
    if (!editingId) return;
    onVariationsChange((cur) =>
      cur.map((v) => (v.id === editingId ? { ...v, sku: skuDraft.trim() || v.sku } : v)),
    );
    setEditingId(null);
  };
  const removeVariation = (id: string) =>
    onVariationsChange((cur) => cur.filter((v) => v.id !== id));

  /* render */
  if (attributes.filter((a) => a.useForVariations).length === 0)
    return (
      <p className="text-center py-8 text-muted-foreground">
        No attributes marked for variations.
      </p>
    );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Affiliate Product Variations</h3>
        <Button type="button" onClick={() => generateVariations()}>
          <Plus className="h-4 w-4 mr-2" />
          Generate Variations
        </Button>
      </div>

      {variations.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">No variations generated yet.</p>
      ) : (
        variations.map((v) => (
          <Card key={v.id} className="overflow-hidden">
            <CardHeader
              className="py-3 px-4 flex items-center justify-between bg-muted/40 cursor-pointer"
              onClick={() => toggle(v.id)}
            >
              <CardTitle className="text-base">
                <div className="flex flex-wrap gap-1">
                  {Object.entries(v.attributes).map(([aid, tid]) => (
                    <Badge key={`${aid}-${tid}`} variant="outline">
                      {label(aid, tid)}
                    </Badge>
                  ))}
                </div>
              </CardTitle>
              <div className="flex items-center gap-2">
                {editingId === v.id ? (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        saveSku();
                      }}
                    >
                      <Save className="h-4 w-4 mr-1" />
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(null);
                      }}
                    >
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditSku(v);
                      }}
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Edit SKU
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="text-red-600"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeVariation(v.id);
                      }}
                    >
                      <Trash className="h-4 w-4 mr-1" />
                      Delete
                    </Button>
                  </>
                )}
                {expandedId === v.id ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </div>
            </CardHeader>

            {expandedId === v.id && (
              <CardContent className="p-4 space-y-8">
                {/* SKU field */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel className="text-sm mb-1 block">SKU</FormLabel>
                    {editingId === v.id ? (
                      <input
                        className="w-full border rounded-md px-3 py-2 text-sm"
                        value={skuDraft}
                        onChange={(e) => setSkuDraft(e.target.value)}
                      />
                    ) : (
                      <div className="p-2 border rounded-md text-sm">{v.sku}</div>
                    )}
                  </div>
                </div>

                {/* Level requirement */}
                <div className="flex flex-col">
                  <FormLabel className="text-sm mb-1 block">
                    Minimum affiliate level required
                  </FormLabel>
                  <LevelRequirementSelect
                    inline
                    value={v.minLevelId}
                    onChange={(id) =>
                      onVariationsChange((cur) =>
                        cur.map((x) => (x.id === v.id ? { ...x, minLevelId: id } : x)),
                      )
                    }
                  />
                </div>

                {/* Image */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel className="text-sm mb-1 block">Variation Image</FormLabel>
                    <VariationImagePicker
                      value={v.image}
                      onChange={(fp) =>
                        onVariationsChange((cur) =>
                          cur.map((x) => (x.id === v.id ? { ...x, image: fp } : x)),
                        )
                      }
                    />
                  </div>
                </div>

                {/* POINTS + COST table */}
                <LevelPointsManagement
                  title="Points per country / level"
                  countries={countries}
                  levels={levels}
                  value={v.prices}
                  onChange={(map) => updatePoints(v.id, map)}
                  costData={v.cost}
                  onCostChange={(m) => updateCost(v.id, m)}
                />

                {/* COST (flat) */}
                <CostManagement
                  title="Cost per country"
                  countries={countries}
                  costData={v.cost}
                  onChange={(m) => updateCost(v.id, m)}
                />

                {/* STOCK */}
                <h4 className="font-medium mt-4">Stock Management</h4>
                {warehouses.map((w) => (
                  <Accordion type="single" collapsible key={w.id}>
                    <AccordionItem value={w.id}>
                      <AccordionTrigger>{w.name}</AccordionTrigger>
                      <AccordionContent>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Country</TableHead>
                              <TableHead className="w-[160px]">Qty</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {w.countries.map((c) => (
                              <TableRow key={`${w.id}-${c}`}>
                                <TableCell>{c}</TableCell>
                                <TableCell>
                                  <input
                                    type="number"
                                    min="0"
                                    className="w-full border rounded-md px-2 py-1 text-sm"
                                    value={v.stock[w.id][c] || 0}
                                    onChange={(e) =>
                                      updateStock(
                                        v.id,
                                        w.id,
                                        c,
                                        Number(e.target.value) || 0,
                                      )
                                    }
                                  />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ))}
              </CardContent>
            )}
          </Card>
        ))
      )}
    </div>
  );

  /* helper to auto-generate variations */
  function generateVariations() {
    if (attributes.every((a) => a.selectedTerms.length === 0)) {
      toast.error("Select attribute terms first");
      return;
    }

    const attrs = attributes
      .filter((a) => a.useForVariations && a.selectedTerms.length)
      .map((a) => ({ id: a.id, terms: a.selectedTerms }));

    const combos: Record<string, string>[] = [];
    const build = (i: number, cur: Record<string, string>) => {
      if (i === attrs.length) {
        combos.push(cur);
        return;
      }
      attrs[i].terms.forEach((t) => build(i + 1, { ...cur, [attrs[i].id]: t }));
    };
    build(0, {});

    const blankPtsByLvl = blankPtsFor(countries, levels);
    const blankCostMap = blankCostFor(countries);
    const blankStockMap: Record<string, Record<string, number>> = warehouses.reduce(
      (acc, w) => ({
        ...acc,
        [w.id]: w.countries.reduce((m, c) => ({ ...m, [c]: 0 }), {} as Record<string, number>),
      }),
      {} as Record<string, Record<string, number>>,
    );

    // ✅ country maps for regularPrice / salePrice
    const blankRegularPrice: Record<string, number> = countries.reduce(
      (acc, c) => ((acc[c] = 0), acc),
      {} as Record<string, number>,
    );
    const blankSalePrice: Record<string, number | null> = countries.reduce(
      (acc, c) => ((acc[c] = null), acc),
      {} as Record<string, number | null>,
    );

    const merged: VariationExt[] = combos.map((combo) => {
      const existing = variations.find((v) =>
        Object.entries(combo).every(([k, vId]) => v.attributes[k] === vId),
      );
      if (existing) return existing;

      return {
        id: uuidv4(),
        attributes: combo,
        sku: `VAR-${uuidv4().slice(0, 8)}`,
        image: null,
        // ✅ match Variation type (per-country maps)
        regularPrice: { ...blankRegularPrice },
        salePrice: { ...blankSalePrice },
        prices: JSON.parse(JSON.stringify(blankPtsByLvl)),
        cost: JSON.parse(JSON.stringify(blankCostMap)),
        minLevelId: null,
        stock: JSON.parse(JSON.stringify(blankStockMap)),
      } as VariationExt;
    });

    onVariationsChange(merged);
    toast.success(`Generated ${merged.length} variations`);
  }

}
