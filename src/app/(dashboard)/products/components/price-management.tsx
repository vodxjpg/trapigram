/* ────────────────────────────────────────────────────────────────
   Cost + Price management table (mobile-friendly)
───────────────────────────────────────────────────────────────── */
"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

/* ------------------------------------------------------------------
   Types
------------------------------------------------------------------ */
export interface PriceMap {
  [country: string]: { regular: number; sale: number | null }
}
export interface CostMap {
  [country: string]: number
}

interface Props {
  title: string
  countries: string[]
  priceData: PriceMap
  costData: CostMap
  onPriceChange: (p: PriceMap) => void
  onCostChange: (c: CostMap) => void
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
  const [open, setOpen] = useState(true)

  /* ---------- helpers ---------- */
  const patchPrice = (country: string, patch: Partial<typeof priceData[string]>) =>
    onPriceChange({
      ...priceData,
      [country]: {
        regular: 0,
        sale: null,
        ...(priceData[country] || {}),
        ...patch,
      },
    })

  const patchCost = (country: string, cost: number) =>
    onCostChange({ ...costData, [country]: cost })

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
          {/* horizontal scroll on small screens */}
          <div className="overflow-x-auto">
            <Table className="min-w-[520px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Country</TableHead>
                  <TableHead className="w-[120px] text-right">Cost</TableHead>
                  <TableHead className="w-[120px] text-right">Regular</TableHead>
                  <TableHead className="w-[120px] text-right">Sale&nbsp;(opt.)</TableHead>
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
  )
}
