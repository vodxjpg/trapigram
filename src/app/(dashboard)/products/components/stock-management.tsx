"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface Warehouse {
  id: string
  name: string
  countries: string[]
}

interface StockManagementProps {
  warehouses: Warehouse[]
  stockData: Record<string, Record<string, number>>
  onStockChange: (data: Record<string, Record<string, number>>) => void
}

export function StockManagement({ warehouses, stockData, onStockChange }: StockManagementProps) {
  const [expandedWarehouses, setExpandedWarehouses] = useState<Record<string, boolean>>({})

  const toggleWarehouse = (warehouseId: string) => {
    setExpandedWarehouses({
      ...expandedWarehouses,
      [warehouseId]: !expandedWarehouses[warehouseId],
    })
  }

  const handleStockChange = (warehouseId: string, country: string, value: number) => {
    const newStockData = {
      ...stockData,
      [warehouseId]: {
        ...stockData[warehouseId],
        [country]: value,
      },
    }
    onStockChange(newStockData)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Stock Quantities by Warehouse</h3>

      {warehouses.length === 0 ? (
        <p className="text-muted-foreground">No warehouses found. Please add warehouses first.</p>
      ) : (
        <div className="space-y-4">
          {warehouses.map((warehouse) => (
            <Card key={warehouse.id}>
              <CardHeader
                className="py-3 px-4 flex flex-row items-center justify-between cursor-pointer"
                onClick={() => toggleWarehouse(warehouse.id)}
              >
                <CardTitle className="text-base">{warehouse.name}</CardTitle>
                <Button variant="ghost" size="sm" type="button">
                  {expandedWarehouses[warehouse.id] ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </Button>
              </CardHeader>

              {expandedWarehouses[warehouse.id] && (
                <CardContent>
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
                              value={stockData[warehouse.id]?.[country] || 0}
                              onChange={(e) =>
                                handleStockChange(warehouse.id, country, Number.parseInt(e.target.value) || 0)
                              }
                            />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}