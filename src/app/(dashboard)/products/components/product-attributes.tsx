"use client"

import { useState, useEffect } from "react"
import { Plus, Trash, Check } from "lucide-react"
import type { Attribute } from "@/types/product"

import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"

interface ProductAttributesProps {
  attributes: Attribute[]
  onAttributesChange: (attributes: Attribute[]) => void
  productType: string
}

export function ProductAttributes({ attributes, onAttributesChange, productType }: ProductAttributesProps) {
  const [availableAttributes, setAvailableAttributes] = useState<Array<{ id: string; name: string }>>([])
  const [selectedAttributeId, setSelectedAttributeId] = useState<string>("")
  const [isLoading, setIsLoading] = useState(false)

  // Fetch available attributes on component mount
  useEffect(() => {
    async function fetchAttributes() {
      setIsLoading(true)
      try {
        const response = await fetch("/api/product-attributes")
        if (!response.ok) throw new Error("Failed to fetch attributes")
        const data = await response.json()
        setAvailableAttributes(data.attributes)
      } catch (error) {
        console.error("Error fetching attributes:", error)
        toast.error("Failed to load product attributes")
      } finally {
        setIsLoading(false)
      }
    }

    fetchAttributes()
  }, [])

  const addAttribute = async () => {
    if (!selectedAttributeId) return

    // Check if attribute is already added
    if (attributes.some((attr) => attr.id === selectedAttributeId)) {
      toast.error("This attribute is already added")
      return
    }

    setIsLoading(true)
    try {
      // Fetch attribute terms
      const response = await fetch(`/api/product-attributes/${selectedAttributeId}/terms`)
      if (!response.ok) throw new Error("Failed to fetch attribute terms")
      const data = await response.json()

      const selectedAttribute = availableAttributes.find((attr) => attr.id === selectedAttributeId)
      if (!selectedAttribute) return

      const newAttribute: Attribute = {
        id: selectedAttributeId,
        name: selectedAttribute.name,
        terms: data.terms || [],
        useForVariations: false,
        selectedTerms: [],
      }

      onAttributesChange([...attributes, newAttribute])
      setSelectedAttributeId("")
    } catch (error) {
      console.error("Error adding attribute:", error)
      toast.error("Failed to add attribute")
    } finally {
      setIsLoading(false)
    }
  }

  const removeAttribute = (attributeId: string) => {
    onAttributesChange(attributes.filter((attr) => attr.id !== attributeId))
  }

  const toggleUseForVariations = (attributeId: string, value: boolean) => {
    onAttributesChange(
      attributes.map((attr) => (attr.id === attributeId ? { ...attr, useForVariations: value } : attr)),
    )
  }

  const toggleTermSelection = (attributeId: string, termId: string) => {
    onAttributesChange(
      attributes.map((attr) => {
        if (attr.id === attributeId) {
          const selectedTerms = [...attr.selectedTerms]
          if (selectedTerms.includes(termId)) {
            return { ...attr, selectedTerms: selectedTerms.filter((id) => id !== termId) }
          } else {
            return { ...attr, selectedTerms: [...selectedTerms, termId] }
          }
        }
        return attr
      }),
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-end gap-4">
        <div className="flex-1">
          <Label htmlFor="attribute-select">Add Attribute</Label>
          <Select value={selectedAttributeId} onValueChange={setSelectedAttributeId} disabled={isLoading}>
            <SelectTrigger id="attribute-select">
              <SelectValue placeholder="Select an attribute" />
            </SelectTrigger>
            <SelectContent>
              {availableAttributes.map((attribute) => (
                <SelectItem key={attribute.id} value={attribute.id}>
                  {attribute.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={addAttribute} disabled={!selectedAttributeId || isLoading}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      </div>

      {attributes.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No attributes added yet. Select an attribute from the dropdown above.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Terms</TableHead>
              {productType === "variable" && <TableHead className="w-[150px]">Use for Variations</TableHead>}
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {attributes.map((attribute) => (
              <TableRow key={attribute.id}>
                <TableCell className="font-medium">{attribute.name}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-2">
                    {attribute.terms.map((term) => (
                      <Badge
                        key={term.id}
                        variant={attribute.selectedTerms.includes(term.id) ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() => toggleTermSelection(attribute.id, term.id)}
                      >
                        {attribute.selectedTerms.includes(term.id) && <Check className="mr-1 h-3 w-3" />}
                        {term.name}
                      </Badge>
                    ))}
                    {attribute.terms.length === 0 && (
                      <span className="text-muted-foreground text-sm">No terms available</span>
                    )}
                  </div>
                </TableCell>
                {productType === "variable" && (
                  <TableCell>
                    <Switch
                      checked={attribute.useForVariations}
                      onCheckedChange={(checked) => toggleUseForVariations(attribute.id, checked)}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => removeAttribute(attribute.id)}>
                    <Trash className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
