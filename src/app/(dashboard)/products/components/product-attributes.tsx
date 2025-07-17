// src/app/(dashboard)/products/components/product-attributes.tsx
"use client"

import { useState, useEffect } from "react"
import { Plus, Trash, Check } from "lucide-react"
import slugify from "slugify"
import type { Attribute } from "@/types/product"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"

interface Props {
  attributes: Attribute[]
  onAttributesChange: (a: Attribute[]) => void
  productType: string
}

const autoSlug = (v: string) => slugify(v, { lower: true, strict: true })

export function ProductAttributes({ attributes, onAttributesChange, productType }: Props) {
  /* ——— fetch available attributes ——— */
  const [available, setAvailable] = useState<Array<{ id: string; name: string }>>([])
  const [loading,   setLoading]   = useState(false)
  const loadAttributes = async () => {
    setLoading(true)
    try {
      const r = await fetch("/api/product-attributes?page=1&pageSize=1000")
      const j = await r.json()
      setAvailable(j.attributes)
    } catch { toast.error("Couldn’t load attributes") } finally { setLoading(false) }
  }
  useEffect(() => { loadAttributes() }, [])

  /* ——— add‑attribute flow ——— */
  const [picker, setPicker] = useState("")
  const [showNewAttr, setShowNewAttr] = useState(false)
  const [attrName, setAttrName] = useState("")
  const [attrSlug, setAttrSlug] = useState("")
  const [savingAttr, setSavingAttr] = useState(false)

  const createAttribute = async () => {
    if (!attrName.trim() || !attrSlug.trim()) return
    setSavingAttr(true)
    try {
      const r = await fetch("/api/product-attributes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: attrName.trim(), slug: attrSlug.trim() }),
      })
      if (!r.ok) throw new Error()
      const created = await r.json()
      toast.success("Attribute created")
      setShowNewAttr(false); setAttrName(""); setAttrSlug("")
      await loadAttributes()
      setPicker(created.id)
      handleAddAttribute(created.id, created.name, [])
    } catch { toast.error("Could not create attribute") } finally { setSavingAttr(false) }
  }

  const handleAddAttribute = async (id?: string, name?: string, terms?: any[]) => {
    const targetId = id ?? picker
    if (!targetId) return
    if (attributes.some(a => a.id === targetId)) {
      toast.error("Attribute already added"); return
    }
    try {
      const resp   = await fetch(`/api/product-attributes/${targetId}/terms?page=1&pageSize=1000`)
      const data   = await resp.json()
      const insert = {
        id: targetId,
        name: name ?? (available.find(a => a.id === targetId)?.name ?? "—"),
        terms: terms ?? data.terms ?? [],
        useForVariations: false,
        selectedTerms: [],
      }
      onAttributesChange([...attributes, insert])
      setPicker("")
    } catch { toast.error("Failed to fetch attribute terms") }
  }

  /* ——— term creation flow ——— */
  const [termModalFor, setTermModalFor] = useState<Attribute | null>(null)
  const [termName, setTermName]   = useState("")
  const [termSlug, setTermSlug]   = useState("")
  const [savingTerm, setSavingTerm] = useState(false)

  const createTerm = async () => {
    if (!termModalFor) return
    if (!termName.trim() || !termSlug.trim()) return
    setSavingTerm(true)
    try {
      const r = await fetch(`/api/product-attributes/${termModalFor.id}/terms`, {
        method: "POST",
        headers: { "Content-Type":"application/json" },
        body: JSON.stringify({ name: termName.trim(), slug: termSlug.trim() }),
      })
      if (!r.ok) throw new Error()
      const created = await r.json()
      toast.success("Term created")
      onAttributesChange(attributes.map(a => a.id === termModalFor.id
        ? { ...a, terms:[...a.terms, created], selectedTerms:[...a.selectedTerms, created.id] }
        : a))
      setTermModalFor(null); setTermName(""); setTermSlug("")
    } catch { toast.error("Could not create term") } finally { setSavingTerm(false) }
  }

  /* ——— misc helpers ——— */
  const removeAttribute = (id: string) =>
    onAttributesChange(attributes.filter(a => a.id !== id))
  const toggleUseForVar = (id: string, v:boolean) =>
    onAttributesChange(attributes.map(a => a.id===id ? {...a,useForVariations:v}:a))
  const toggleTerm = (attrId:string, termId:string) =>
    onAttributesChange(attributes.map(a => {
      if (a.id!==attrId) return a
      const sel = a.selectedTerms.includes(termId)
        ? a.selectedTerms.filter(t=>t!==termId)
        : [...a.selectedTerms, termId]
      return {...a, selectedTerms:sel}
    }))

  /* ——— render ——— */
  return (
    <div className="space-y-6">
      {/* picker row */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[200px]">
          <Label>Add Attribute</Label>
          <Select value={picker} onValueChange={setPicker} disabled={loading}>
            <SelectTrigger><SelectValue placeholder="Select attribute" /></SelectTrigger>
            <SelectContent>
              {available.map(a =>
                <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          onClick={() => handleAddAttribute()}
          disabled={!picker}
        >
          Add
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => setShowNewAttr(true)}
        >
          + New&nbsp;attribute
        </Button>
      </div>

      {/* table */}
      {attributes.length === 0 ? (
        <p className="text-center py-8 text-muted-foreground">No attributes added.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Terms</TableHead>
                {productType==="variable" && <TableHead>For&nbsp;Variations</TableHead>}
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {attributes.map(attr=>(
                <TableRow key={attr.id}>
                  <TableCell className="font-medium">{attr.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-2">
                      {attr.terms.map(t=>(
                        <Badge
                          key={t.id}
                          variant={attr.selectedTerms.includes(t.id)?"default":"outline"}
                          onClick={()=>toggleTerm(attr.id,t.id)}
                          className="cursor-pointer select-none"
                        >
                          {attr.selectedTerms.includes(t.id) && <Check className="mr-1 h-3 w-3" />}
                          {t.name}
                        </Badge>
                      ))}
                      <Badge
                        variant="secondary"
                        className="cursor-pointer select-none"
                        onClick={()=>{ setTermModalFor(attr); setTermName(""); setTermSlug("")}}
                      >
                        <Plus className="h-3 w-3" />&nbsp;Add term
                      </Badge>
                    </div>
                  </TableCell>
                  {productType==="variable" && (
                    <TableCell>
                      <Switch
                        checked={attr.useForVariations}
                        onCheckedChange={v=>toggleUseForVar(attr.id,v)}
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={()=>removeAttribute(attr.id)}
                    >
                      <Trash className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* new‑attribute dialog */}
      <Dialog open={showNewAttr} onOpenChange={setShowNewAttr}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>New Attribute</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={attrName} onChange={e=>{
                setAttrName(e.target.value)
                setAttrSlug(autoSlug(e.target.value))
              }} />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={attrSlug} onChange={e=>setAttrSlug(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={()=>setShowNewAttr(false)}>Cancel</Button>
            <Button type="button" disabled={!attrName||!attrSlug||savingAttr} onClick={createAttribute}>
              {savingAttr?"Saving…":"Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* new‑trm dialog */}
      <Dialog open={!!termModalFor} onOpenChange={()=>setTermModalFor(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>
            New term for “{termModalFor?.name}”
          </DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name</Label>
              <Input value={termName} onChange={e=>{
                setTermName(e.target.value)
                setTermSlug(autoSlug(e.target.value))
              }} />
            </div>
            <div>
              <Label>Slug</Label>
              <Input value={termSlug} onChange={e=>setTermSlug(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={()=>setTermModalFor(null)}>Cancel</Button>
            <Button type="button" disabled={!termName||!termSlug||savingTerm} onClick={createTerm}>
              {savingTerm?"Saving…":"Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
