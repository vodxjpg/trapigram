"use client"

import { useState, useEffect } from "react"
import { Plus, Trash, Edit, Save, X, ChevronDown, ChevronUp } from "lucide-react"
import { v4 as uuidv4 } from "uuid"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Attribute, Variation, Warehouse } from "@/types/product"

interface ProductVariationsProps {
  attributes: Attribute[]
  variations: Variation[]
  onVariationsChange: (variations: Variation[]) => void
  warehouses: Warehouse[]
}

export function ProductVariations({ attributes, variations, onVariationsChange, warehouses }: ProductVariationsProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [form, setForm] = useState<{ sku: string; regularPrice: string; salePrice: string }>({ sku: "", regularPrice: "", salePrice: "" })

  // ensure stock shape is always complete
  useEffect(() => {
    if (warehouses.length === 0) return
    const filled = variations.map((v) => {
      const stock: Record<string, Record<string, number>> = { ...(v.stock || {}) }
      warehouses.forEach((w) => {
        if (!stock[w.id]) stock[w.id] = {}
        w.countries.forEach((c) => {
          if (stock[w.id][c] == null) stock[w.id][c] = 0
        })
      })
      return { ...v, stock }
    })
    onVariationsChange(filled)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses])

  const generateVariations = () => {
    if (attributes.length === 0 || attributes.every((a) => a.selectedTerms.length === 0)) {
      toast.error("Please select at least one attribute term for variations")
      return
    }

    const attrs = attributes
      .filter((a) => a.useForVariations && a.selectedTerms.length > 0)
      .map((a) => ({ id: a.id, name: a.name, terms: a.terms.filter((t) => a.selectedTerms.includes(t.id)) }))

    if (attrs.length === 0) {
      toast.error("Please mark at least one attribute for variations")
      return
    }

    const combos: Record<string, string>[] = []
    const build = (idx: number, cur: Record<string, string>) => {
      if (idx === attrs.length) {
        combos.push(cur)
        return
      }
      const a = attrs[idx]
      a.terms.forEach((t) => build(idx + 1, { ...cur, [a.id]: t.id }))
    }
    build(0, {})

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
          regularPrice: 0,
          salePrice: null,
          stock: JSON.parse(JSON.stringify(blankStock)),
        }
      )
    })

    onVariationsChange(merged)
    toast.success(`Generated ${merged.length} variations`)
  }

  const startEditing = (v: Variation) => {
    setEditingId(v.id)
    setExpandedId(v.id)
    setForm({
      sku: v.sku,
      regularPrice: String(v.regularPrice ?? ""),
      salePrice: v.salePrice == null ? "" : String(v.salePrice),
    })
  }

  const save = () => {
    if (!editingId) return
    onVariationsChange(
      variations.map((v) =>
        v.id === editingId
          ? {
              ...v,
              sku: form.sku.trim() || v.sku,
              regularPrice: Number(form.regularPrice) || 0,
              salePrice: form.salePrice === "" ? null : Number(form.salePrice) || 0,
            }
          : v,
      ),
    )
    setEditingId(null)
  }

  const cancel = () => setEditingId(null)

  const remove = (id: string) => onVariationsChange(variations.filter((v) => v.id !== id))

  const toggle = (id: string) => setExpandedId((p) => (p === id ? null : id))

  const updateStock = (vid: string, wid: string, country: string, value: number) => {
    onVariationsChange(
      variations.map((v) =>
        v.id === vid
          ? { ...v, stock: { ...v.stock, [wid]: { ...v.stock[wid], [country]: value } } }
          : v,
      ),
    )
  }

  const label = (aid: string, tid: string) => {
    const a = attributes.find((x) => x.id === aid)
    const t = a?.terms.find((y) => y.id === tid)
    return a && t ? `${a.name}: ${t.name}` : ""
  }

  return (
    <div className="space-y-6">
      {attributes.filter((a) => a.useForVariations).length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">No attributes marked for variations.</div>
      ) : (
        <>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Product Variations</h3>
            <Button type="button" onClick={generateVariations}>
              <Plus className="mr-2 h-4 w-4" /> Generate Variations
            </Button>
          </div>

          {variations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No variations generated yet.</div>
          ) : (
            <div className="space-y-4">
              {variations.map((v) => (
                <Card key={v.id} className="overflow-hidden">
                  <CardHeader
                    className="py-3 px-4 flex flex-row items-center justify-between bg-muted/40 cursor-pointer"
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
                          <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); save() }}>
                            <Save className="h-4 w-4 mr-1" /> Save
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); cancel() }}>
                            <X className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); startEditing(v) }}>
                            <Edit className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="text-red-500" onClick={(e) => { e.stopPropagation(); remove(v.id) }}>
                            <Trash className="h-4 w-4 mr-1" /> Delete
                          </Button>
                        </>
                      )}
                      {expandedId === v.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </div>
                  </CardHeader>

                  {expandedId === v.id && (
                    <CardContent className="p-4">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        {/* SKU */}
                        <div>
                          <span className="text-sm font-medium mb-1 block">SKU</span>
                          {editingId === v.id ? (
                            <input
                              className="w-full border rounded-md px-3 py-2 text-sm"
                              value={form.sku}
                              onChange={(e) => setForm({ ...form, sku: e.target.value })}
                            />
                          ) : (
                            <div className="p-2 border rounded-md text-sm">{v.sku}</div>
                          )}
                        </div>

                        {/* Regular price */}
                        <div>
                          <span className="text-sm font-medium mb-1 block">Regular Price</span>
                          {editingId === v.id ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full border rounded-md px-3 py-2 text-sm"
                              value={form.regularPrice}
                              onChange={(e) => setForm({ ...form, regularPrice: e.target.value })}
                            />
                          ) : (
                            <div className="p-2 border rounded-md text-sm">${v.regularPrice}</div>
                          )}
                        </div>

                        {/* Sale price */}
                        <div>
                          <span className="text-sm font-medium mb-1 block">Sale Price</span>
                          {editingId === v.id ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              className="w-full border rounded-md px-3 py-2 text-sm"
                              value={form.salePrice}
                              onChange={(e) => setForm({ ...form, salePrice: e.target.value })}
                            />
                          ) : (
                            <div className="p-2 border rounded-md text-sm">{v.salePrice == null ? "-" : `$${v.salePrice}`}</div>
                          )}
                        </div>
                      </div>

                      {/* STOCK */}
                      <h4 className="font-medium mb-2">Stock Management</h4>
                      <div className="space-y-4">
                        {warehouses.map((w) => (
                          <Accordion type="single" collapsible key={w.id}>
                            <AccordionItem value={w.id}>
                              <AccordionTrigger>{w.name}</AccordionTrigger>
                              <AccordionContent>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Country</TableHead>
                                      <TableHead className="w-[200px]">Stock Quantity</TableHead>
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
                                            value={v.stock[w.id][c]}
                                            onChange={(e) => updateStock(v.id, w.id, c, Number(e.target.value) || 0)}
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
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
