"use client"

import { useState, useEffect } from "react"
import { Plus, Trash, Edit, Save, X, ChevronDown, ChevronUp } from "lucide-react"
import { v4 as uuidv4 } from "uuid"

import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { FormLabel } from "@/components/ui/form"
import { PriceManagement } from "./price-management"
import { CostManagement } from "./cost-management"
import type { Attribute, Variation, Warehouse } from "@/types/product"

// ---------------------------------------------------------------------------
// helpers / types
// ---------------------------------------------------------------------------
type PriceMap = Record<string, { regular: number; sale: number | null }>
type CostMap = Record<string, number>

interface VariationExt extends Variation {
  prices: PriceMap
  cost: CostMap
  stock: Record<string, Record<string, number>> // Maintained for UI, transformed in product-form.tsx
}

interface Props {
  attributes: Attribute[]
  variations: VariationExt[]
  onVariationsChange: React.Dispatch<React.SetStateAction<VariationExt[]>>
  warehouses: Warehouse[]
  countries: string[]
}

// ---------------------------------------------------------------------------
// component
// ---------------------------------------------------------------------------

/* -----------------------------------------------------------
   Upload / preview widget reused by each variation card
----------------------------------------------------------- */
function VariationImagePicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (url: string | null) => void
}) {
  const [preview, setPreview] = useState<string | null>(value)

  /* one stable ID per instance */
  const inputId = useState(() => `var-img-${uuidv4()}`)[0]

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch("/api/upload", { method: "POST", body: fd })
    if (!res.ok) {
      return
    }
    const { filePath } = await res.json()
    setPreview(filePath)
    onChange(filePath)
  }

  return (
    <>
      {preview ? (
        <div className="relative w-full h-40 rounded-md overflow-hidden mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Variation" className="object-cover w-full h-full" />
        </div>
      ) : (
        <div className="w-full h-40 border border-dashed rounded-md flex items-center justify-center mb-2">
          <span className="text-xs text-muted-foreground">No image</span>
        </div>
      )}

      {/* input & button use the SAME id ----------------------------- */}
      <input
        type="file"
        accept="image/*"
        id={inputId}
        className="hidden"
        onChange={handleUpload}
      />
      <Button
        variant="outline"
        type="button"
        onClick={() => document.getElementById(inputId)?.click()}
        className="w-full"
      >
        {preview ? "Change Image" : "Upload Image"}
      </Button>
    </>
  )
}

export function ProductVariations({
  attributes,
  variations,
  onVariationsChange,
  warehouses,
  countries,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [skuDraft, setSkuDraft] = useState("")

  // ensure every variation has prices, cost, and stock for each country -------
  useEffect(() => {
    if (countries.length === 0 || warehouses.length === 0) return
    onVariationsChange((cur) =>
      cur.map((v) => {
        /* prices --------------------------------------------------------- */
        const priceMap: PriceMap = { ...(v.prices || {}) }
        let priceChanged = false
        countries.forEach((c) => {
          if (!priceMap[c]) {
            priceMap[c] = { regular: 0, sale: null }
            priceChanged = true
          }
        })

        /* cost ----------------------------------------------------------- */
        const costMap: CostMap = { ...(v.cost || {}) }
        let costChanged = false
        countries.forEach((c) => {
          if (costMap[c] == null) {
            costMap[c] = 0
            costChanged = true
          }
        })

        /* stock (UI only) ----------------------------------------------- */
        const stock: Record<string, Record<string, number>> = { ...(v.stock || {}) }
        let stockChanged = false
        warehouses.forEach((w) => {
          if (!stock[w.id]) {
            stock[w.id] = {}
            stockChanged = true
          }
          w.countries.forEach((c) => {
            // Only initialize if the stock value is undefined
            if (stock[w.id][c] === undefined) {
              stock[w.id][c] = 0
              stockChanged = true
            }
          })
        })

        if (!priceChanged && !costChanged && !stockChanged) return v
        return { ...v, prices: priceMap, cost: costMap, stock }
      }),
    )
  }, [countries, warehouses, onVariationsChange])

  // ui helpers -------------------------------------------------------------
  const label = (aid: string, tid: string) => {
    const a = attributes.find((x) => x.id === aid)
    const t = a?.terms.find((y) => y.id === tid)
    return a && t ? `${a.name}: ${t.name}` : ""
  }
  const toggle = (id: string) => setExpandedId((p) => (p === id ? null : id))

  // generate variations -----------------------------------------------------
  const generateVariations = () => {
    if (attributes.every((a) => a.selectedTerms.length === 0)) {
      toast.error("Select attribute terms first")
      return
    }
    const attrs = attributes
      .filter((a) => a.useForVariations && a.selectedTerms.length)
      .map((a) => ({ id: a.id, terms: a.selectedTerms }))

    const combos: Record<string, string>[] = []
    const build = (idx: number, cur: Record<string, string>) => {
      if (idx === attrs.length) return combos.push(cur)
      const a = attrs[idx]
      a.terms.forEach((t) => build(idx + 1, { ...cur, [a.id]: t }))
    }
    build(0, {})

    /* blank maps -------------------------------------------------------- */
    const blankPrices: PriceMap = {}
    const blankCosts: CostMap = {}
    countries.forEach((c) => {
      blankPrices[c] = { regular: 0, sale: null }
      blankCosts[c] = 0
    })

    /* blank stock for UI ----------------------------------------------- */
    const blankStock: Record<string, Record<string, number>> = {}
    warehouses.forEach((w) => {
      blankStock[w.id] = {}
      w.countries.forEach((c) => (blankStock[w.id][c] = 0))
    })

    const merged = combos.map((combo) => {
      const existing = variations.find((v) => Object.entries(combo).every(([k, vId]) => v.attributes[k] === vId))
      return (
        existing || {
          id: uuidv4(),
          attributes: combo,
          sku: `VAR-${uuidv4().slice(0, 8)}`,
          image: null,
          prices: JSON.parse(JSON.stringify(blankPrices)),
          cost: JSON.parse(JSON.stringify(blankCosts)),
          stock: JSON.parse(JSON.stringify(blankStock)),
        }
      )
    })

    onVariationsChange(merged)
    toast.success(`Generated ${merged.length} variations`)
  }

  // CRUD helpers -----------------------------------------------------------
  const startEditSku = (v: VariationExt) => {
    setEditingId(v.id)
    setSkuDraft(v.sku)
    setExpandedId(v.id)
  }
  const saveSku = () => {
    if (!editingId) return
    onVariationsChange((cur) => cur.map((v) => (v.id === editingId ? { ...v, sku: skuDraft.trim() || v.sku } : v)))
    setEditingId(null)
  }
  const removeVariation = (id: string) => onVariationsChange((cur) => cur.filter((v) => v.id !== id))

  const updatePrice = (vid: string, map: PriceMap) =>
    onVariationsChange((cur) => cur.map((v) => (v.id === vid ? { ...v, prices: map } : v)))

  const updateCost = (vid: string, map: CostMap) =>
    onVariationsChange((cur) => cur.map((v) => (v.id === vid ? { ...v, cost: map } : v)))

  const updateStock = (vid: string, wid: string, c: string, qty: number) =>
    onVariationsChange((cur) =>
      cur.map((v) =>
        v.id === vid ? { ...v, stock: { ...v.stock, [wid]: { ...v.stock[wid], [c]: qty } } } : v,
      ),
    )

  // render ------------------------------------------------------------------
  if (attributes.filter((a) => a.useForVariations).length === 0)
    return <p className="text-center py-8 text-muted-foreground">No attributes marked for variations.</p>

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Product Variations</h3>
        <Button type="button" onClick={generateVariations}>
          <Plus className="h-4 w-4 mr-2" /> Generate Variations
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
                    <Button variant="ghost" size="sm" type="button" onClick={(e) => { e.stopPropagation(); saveSku() }}>
                      <Save className="h-4 w-4 mr-1" /> Save
                    </Button>
                    <Button variant="ghost" size="sm" type="button" onClick={(e) => { e.stopPropagation(); setEditingId(null) }}>
                      <X className="h-4 w-4 mr-1" /> Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" type="button" onClick={(e) => { e.stopPropagation(); startEditSku(v) }}>
                      <Edit className="h-4 w-4 mr-1" /> Edit SKU
                    </Button>
                    <Button variant="ghost" size="sm" type="button" className="text-red-600" onClick={(e) => { e.stopPropagation(); removeVariation(v.id) }}>
                      <Trash className="h-4 w-4 mr-1" /> Delete
                    </Button>
                  </>
                )}
                {expandedId === v.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>

            {expandedId === v.id && (
              <CardContent className="p-4 space-y-8">
                {/* SKU ------------------------------------------------------- */}
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

                {/* IMAGE ---------------------------------------------------- */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <FormLabel className="text-sm mb-1 block">Variation Image</FormLabel>
                    <VariationImagePicker
                      value={v.image}
                      onChange={(filePath) =>
                        onVariationsChange((cur) =>
                          cur.map((x) => (x.id === v.id ? { ...x, image: filePath } : x))
                        )
                      }
                    />
                  </div>
                </div>

                {/* PRICES ---------------------------------------------------- */}
                <PriceManagement
                  title="Prices per country"
                  countries={countries}
                  priceData={v.prices}
                  onChange={(map) => updatePrice(v.id, map)}
                />

                {/* COST ------------------------------------------------------ */}
                <CostManagement
                  title="Cost per country"
                  countries={countries}
                  costData={v.cost}
                  onChange={(map) => updateCost(v.id, map)}
                />

                {/* STOCK ----------------------------------------------------- */}
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
                                      updateStock(v.id, w.id, c, Number(e.target.value) || 0)
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
  )
}