/* ------------------------------------------------------------------
   Country‑based cost input table – identical UX to PriceManagement
------------------------------------------------------------------ */
"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

interface CostMap { [country:string]: number }

interface Props {
  title: string
  countries: string[]
  costData: CostMap
  onChange: (c:CostMap)=>void
}

export function CostManagement({ title,countries,costData={},onChange }:Props) {
  const [open,setOpen] = useState(true)
  const update = (c:string,val:number)=>onChange({ ...costData,[c]:val })

  return (
    <Card>
      <CardHeader onClick={()=>setOpen(p=>!p)} className="cursor-pointer flex items-center justify-between py-3 px-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {open ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
      </CardHeader>

      {open && (
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Country</TableHead>
                <TableHead className="w-[140px] text-right">Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {countries.map(c=>(
                <TableRow key={c}>
                  <TableCell>{c}</TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={costData[c] ?? 0}
                      onChange={e=>update(c,Number.parseFloat(e.target.value)||0)}
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
