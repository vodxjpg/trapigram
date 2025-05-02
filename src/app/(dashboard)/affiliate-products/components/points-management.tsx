"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface CountryPoints { regular: number; sale: number | null }
interface PointsMap { [country: string]: CountryPoints }

interface Props {
  title:      string
  countries:  string[]
  pointsData: PointsMap
  onChange:  (p: PointsMap) => void
}

export function PointsManagement({ title, countries, pointsData = {}, onChange }: Props) {
  const [open, setOpen] = useState(true)

  const update = (c: string, patch: Partial<CountryPoints>) =>
    onChange({
      ...pointsData,
      [c]: { regular: 0, sale: null, ...(pointsData[c] || {}), ...patch },
    })

  return (
    <Card>
      <CardHeader
        onClick={() => setOpen(p => !p)}
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
                <TableHead className="w-[130px] text-right">Regular</TableHead>
                <TableHead className="w-[130px] text-right">Sale&nbsp;(opt.)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {countries.map(c => (
                <TableRow key={c}>
                  <TableCell>{c}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      value={pointsData[c]?.regular ?? 0}
                      onChange={e =>
                        update(c, { regular: Number.parseInt(e.target.value) || 0 })
                      }
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      value={pointsData[c]?.sale ?? ""}
                      onChange={e =>
                        update(c, {
                          sale:
                            e.target.value.trim() === ""
                              ? null
                              : Number.parseInt(e.target.value) || 0,
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
