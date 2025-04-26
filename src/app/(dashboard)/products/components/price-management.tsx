"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

/* ------------------------------------------------------------------ */
/*  types                                                             */
/* ------------------------------------------------------------------ */
interface CountryPrice { regular: number; sale: number | null }
interface PriceMap { [country: string]: CountryPrice }

interface PriceManagementProps {
  title: string
  countries: string[]           // list from org API
  priceData: PriceMap           // full map
  onChange: (p: PriceMap) => void
}

/* ------------------------------------------------------------------ */
/*  component                                                         */
/* ------------------------------------------------------------------ */
export function PriceManagement({
  title,
  countries,
  priceData = {},
  onChange,
}: PriceManagementProps) {
  const [open, setOpen] = useState(true)

  const update = (c: string, patch: Partial<CountryPrice>) => {
    onChange({
      ...priceData,
      [c]: { regular: 0, sale: null, ...(priceData[c] || {}), ...patch },
    })
  }

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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead className="w-[140px] text-right">Regular</TableHead>
                <TableHead className="w-[140px] text-right">Sale&nbsp;(opt.)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {countries.map((c) => (
                <TableRow key={c}>
                  <TableCell>{c}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceData[c]?.regular ?? 0}
                      onChange={(e) =>
                        update(c, { regular: Number.parseFloat(e.target.value) || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={priceData[c]?.sale ?? ""}
                      onChange={(e) =>
                        update(c, {
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
        </CardContent>
      )}
    </Card>
  )
}
