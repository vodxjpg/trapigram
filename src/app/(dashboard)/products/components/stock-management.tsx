// src/app/(dashboard)/products/components/stock-management.tsx
"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Warehouse {
  id: string;
  name: string;
  countries: string[];
}

interface StockManagementProps {
  warehouses: Warehouse[];
  /**
   * stockData[warehouseId][country] = number
   * Use NaN/undefined to represent “blank” in the UI.
   */
  stockData: Record<string, Record<string, number | undefined>>;
  onStockChange: (data: Record<string, Record<string, number | undefined>>) => void;
}

export function StockManagement({
  warehouses,
  stockData,
  onStockChange,
}: StockManagementProps) {
  const [expandedWarehouses, setExpandedWarehouses] = useState<Record<string, boolean>>({});

  const toggleWarehouse = (warehouseId: string) => {
    setExpandedWarehouses((prev) => ({
      ...prev,
      [warehouseId]: !prev[warehouseId],
    }));
  };

  /**
   * Update a single cell.
   * - Empty input → store NaN (or undefined) so it renders as "".
   * - Non-empty → clamp to >= 0.
   */
  const handleStockChange = (warehouseId: string, country: string, raw: string) => {
    // empty field → treat as blank (NaN)
    const isBlank = raw.trim() === "";
    const parsed = isBlank ? NaN : Number(raw);

    const next: Record<string, Record<string, number | undefined>> = {
      ...stockData,
      [warehouseId]: { ...(stockData[warehouseId] ?? {}) },
    };

    // We keep NaN to preserve “blank” UI state; undefined is fine as well.
    next[warehouseId][country] = isBlank
      ? NaN
      : Number.isFinite(parsed)
        ? Math.max(0, parsed)
        : NaN;

    onStockChange(next);
  };

  const displayValue = (val: number | undefined) =>
    val === undefined || Number.isNaN(val) ? "" : String(val);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium">Stock Quantities by Warehouse</h3>

      {warehouses.length === 0 ? (
        <p className="text-muted-foreground">
          No warehouses found. Please add warehouses first.
        </p>
      ) : (
        <div className="space-y-4">
          {warehouses.map((warehouse) => {
            const isOpen = !!expandedWarehouses[warehouse.id];

            return (
              <Card key={warehouse.id}>
                <CardHeader
                  className="py-3 px-4 flex flex-row items-center justify-between cursor-pointer"
                  onClick={() => toggleWarehouse(warehouse.id)}
                >
                  <CardTitle className="text-base">{warehouse.name}</CardTitle>
                  <Button variant="ghost" size="sm" type="button" tabIndex={-1}>
                    {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CardHeader>

                {isOpen && (
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Country</TableHead>
                          <TableHead className="w-[200px]">Stock Quantity</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {warehouse.countries.map((country) => {
                          const current = stockData[warehouse.id]?.[country];

                          return (
                            <TableRow key={`${warehouse.id}-${country}`}>
                              <TableCell>{country}</TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0"
                                  inputMode="numeric"
                                  value={displayValue(current)}
                                  onChange={(e) =>
                                    handleStockChange(warehouse.id, country, e.target.value)
                                  }
                                  placeholder="e.g. 12"
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
