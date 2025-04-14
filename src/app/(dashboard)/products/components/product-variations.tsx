"use client"

import { useState } from "react"
import { Plus, Trash, Edit, Save, X, ChevronDown, ChevronUp } from "lucide-react"
import { v4 as uuidv4 } from "uuid"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { Attribute, Variation, Warehouse } from "@/types/products"

interface ProductVariationsProps {
  attributes: Attribute[]
  variations: Variation[]
  onVariationsChange: (variations: Variation[]) => void
  warehouses: Warehouse[]
}

export function ProductVariations({ attributes, variations, onVariationsChange, warehouses }: ProductVariationsProps) {
  const [editingVariation, setEditingVariation] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<Variation>>({})
  const [expandedVariation, setExpandedVariation] = useState<string | null>(null)

  // Generate all possible combinations of attribute terms
  const generateVariations = () => {
    if (attributes.length === 0 || attributes.every((attr) => attr.selectedTerms.length === 0)) {
      toast.error("Please select at least one attribute term for variations")
      return
    }

    // Get all selected attributes and their terms
    const attributesWithTerms = attributes
      .filter((attr) => attr.useForVariations && attr.selectedTerms.length > 0)
      .map((attr) => ({
        id: attr.id,
        name: attr.name,
        terms: attr.terms.filter((term) => attr.selectedTerms.includes(term.id)),
      }))

    if (attributesWithTerms.length === 0) {
      toast.error("Please mark at least one attribute for variations")
      return
    }

    // Generate all combinations
    const generateCombinations = (
      attributes: Array<{ id: string; name: string; terms: Array<{ id: string; name: string }> }>,
      index = 0,
      current: Record<string, string> = {},
    ): Array<Record<string, string>> => {
      if (index === attributes.length) {
        return [current]
      }

      const attribute = attributes[index]
      const combinations: Array<Record<string, string>> = []

      for (const term of attribute.terms) {
        combinations.push(...generateCombinations(attributes, index + 1, { ...current, [attribute.id]: term.id }))
      }

      return combinations
    }

    const combinations = generateCombinations(attributesWithTerms)

    // Create variations from combinations
    const newVariations = combinations.map((combo) => {
      // Check if this combination already exists in variations
      const existingVariation = variations.find((v) => {
        return Object.entries(combo).every(([attrId, termId]) => v.attributes[attrId] === termId)
      })

      if (existingVariation) {
        return existingVariation
      }

      // Initialize stock data structure
      const stockData: Record<string, Record<string, number>> = {}
      warehouses.forEach((warehouse) => {
        stockData[warehouse.id] = {}
        warehouse.countries.forEach((country) => {
          stockData[warehouse.id][country] = 0
        })
      })

      // Create a new variation with a text-based ID
      return {
        id: uuidv4(),
        attributes: combo,
        sku: `VAR-${uuidv4().slice(0, 8)}`,
        regularPrice: 0,
        salePrice: null,
        stock: stockData,
      }
    })

    onVariationsChange(newVariations)

    toast.success(`Generated ${newVariations.length} variations`)
  }

  const startEditing = (variation: Variation) => {
    setEditingVariation(variation.id)
    setEditForm({
      sku: variation.sku,
      regularPrice: variation.regularPrice,
      salePrice: variation.salePrice,
    })
  }

  const saveEditing = () => {
    if (!editingVariation) return

    onVariationsChange(variations.map((v) => (v.id === editingVariation ? { ...v, ...editForm } : v)))

    setEditingVariation(null)
    setEditForm({})
  }

  const cancelEditing = () => {
    setEditingVariation(null)
    setEditForm({})
  }

  const deleteVariation = (variationId: string) => {
    onVariationsChange(variations.filter((v) => v.id !== variationId))
  }

  const toggleExpandVariation = (variationId: string) => {
    setExpandedVariation(expandedVariation === variationId ? null : variationId)
  }

  const updateVariationStock = (variationId: string, warehouseId: string, country: string, value: number) => {
    onVariationsChange(
      variations.map((v) => {
        if (v.id === variationId) {
          return {
            ...v,
            stock: {
              ...v.stock,
              [warehouseId]: {
                ...v.stock[warehouseId],
                [country]: value,
              },
            },
          }
        }
        return v
      }),
    )
  }

  // Get attribute and term names for display
  const getAttributeTermName = (attributeId: string, termId: string) => {
    const attribute = attributes.find((a) => a.id === attributeId)
    if (!attribute) return ""
    const term = attribute.terms.find((t) => t.id === termId)
    if (!term) return ""
    return `${attribute.name}: ${term.name}`
  }

  return (
    <div className="space-y-6">
      {attributes.filter((attr) => attr.useForVariations).length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No attributes marked for variations. Go to the Attributes tab and mark at least one attribute for variations.
        </div>
      ) : (
        <>
          <div className="flex justify-between items-center">
            <h3 className="text-lg font-medium">Product Variations</h3>
            <Button onClick={generateVariations}>
              <Plus className="mr-2 h-4 w-4" />
              Generate Variations
            </Button>
          </div>

          {variations.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No variations generated yet. Click the button above to generate variations based on your selected attributes.
            </div>
          ) : (
            <div className="space-y-4">
              {variations.map((variation) => (
                <Card key={variation.id} className="overflow-hidden">
                  <CardHeader
                    className="py-3 px-4 flex flex-row items-center justify-between cursor-pointer bg-muted/40"
                    onClick={() => toggleExpandVariation(variation.id)}
                  >
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-base">
                        <div className="flex flex-wrap gap-1">
                          {Object.entries(variation.attributes).map(([attrId, termId]) => (
                            <Badge key={`${attrId}-${termId}`} variant="outline">
                              {getAttributeTermName(attrId, termId)}
                            </Badge>
                          ))}
                        </div>
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-2">
                      {editingVariation === variation.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              saveEditing()
                            }}
                          >
                            <Save className="h-4 w-4 mr-1" /> Save
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              cancelEditing()
                            }}
                          >
                            <X className="h-4 w-4 mr-1" /> Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              startEditing(variation)
                            }}
                          >
                            <Edit className="h-4 w-4 mr-1" /> Edit
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500"
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteVariation(variation.id)
                            }}
                          >
                            <Trash className="h-4 w-4 mr-1" /> Delete
                          </Button>
                        </>
                      )}
                      {expandedVariation === variation.id ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </div>
                  </CardHeader>
                  {expandedVariation === variation.id && (
                    <CardContent className="p-4">
                      <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                          <label className="text-sm font-medium mb-1 block">SKU</label>
                          {editingVariation === variation.id ? (
                            <Input
                              value={editForm.sku || ""}
                              onChange={(e) => setEditForm({ ...editForm, sku: e.target.value })}
                              className="w-full"
                            />
                          ) : (
                            <div className="p-2 border rounded-md">{variation.sku}</div>
                          )}
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Regular Price</label>
                          {editingVariation === variation.id ? (
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editForm.regularPrice || 0}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  regularPrice: Number.parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full"
                            />
                          ) : (
                            <div className="p-2 border rounded-md">${variation.regularPrice}</div>
                          )}
                        </div>
                        <div>
                          <label className="text-sm font-medium mb-1 block">Sale Price</label>
                          {editingVariation === variation.id ? (
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={editForm.salePrice === null ? "" : editForm.salePrice}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  salePrice: e.target.value === "" ? null : Number.parseFloat(e.target.value) || 0,
                                })
                              }
                              className="w-full"
                            />
                          ) : (
                            <div className="p-2 border rounded-md">
                              {variation.salePrice === null ? "-" : `$${variation.salePrice}`}
                            </div>
                          )}
                        </div>
                      </div>

                      <h4 className="font-medium mb-2">Stock Management</h4>
                      <div className="space-y-4">
                        {warehouses.map((warehouse) => (
                          <Accordion type="single" collapsible key={warehouse.id}>
                            <AccordionItem value={warehouse.id}>
                              <AccordionTrigger>{warehouse.name}</AccordionTrigger>
                              <AccordionContent>
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead>Country</TableHead>
                                      <TableHead className="w-[200px]">Stock Quantity</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {warehouse.countries.map((country) => (
                                      <TableRow key={`${warehouse.id}-${country}`}>
                                        <TableCell>{country}</TableCell>
                                        <TableCell>
                                          <Input
                                            type="number"
                                            min="0"
                                            value={variation.stock[warehouse.id]?.[country] || 0}
                                            onChange={(e) =>
                                              updateVariationStock(
                                                variation.id,
                                                warehouse.id,
                                                country,
                                                Number.parseInt(e.target.value) || 0,
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
