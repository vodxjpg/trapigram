"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, MonitorDot } from "lucide-react"

type Store = { id: string; name: string }
type Register = { id: string; label: string; storeId: string }

type Props = {
  storeId: string | null
  registerId: string | null
  onChange: (p: { storeId: string; registerId: string }) => void
}

export function StoreRegisterSelector({ storeId, registerId, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [registers, setRegisters] = useState<Register[]>([])
  const [selStore, setSelStore] = useState<string | null>(storeId)
  const [selRegister, setSelRegister] = useState<string | null>(registerId)

  const regsForStore = useMemo(
    () => registers.filter(r => r.storeId === selStore),
    [registers, selStore]
  )

  useEffect(() => {
    setSelStore(storeId)
    setSelRegister(registerId)
  }, [storeId, registerId])

  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const s = await fetch("/api/pos/stores").then(r => r.json())
        if (!ignore) setStores(s.stores || [])
      } catch (e) {
        console.error("load stores", e)
      }
    })()
    return () => { ignore = true }
  }, [])

  useEffect(() => {
    if (!selStore) return
    let ignore = false
    ;(async () => {
      try {
        const r = await fetch(`/api/pos/registers?storeId=${encodeURIComponent(selStore)}`).then(res => res.json())
        if (!ignore) setRegisters(r.registers || [])
      } catch (e) {
        console.error("load registers", e)
      }
    })()
    return () => { ignore = true }
  }, [selStore])

  const currentStoreName = stores.find(s => s.id === storeId)?.name || "Select store"
  const currentRegisterLabel = registers.find(r => r.id === registerId)?.label || "Select register"

  const canSave = Boolean(selStore && selRegister)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <Building2 className="h-4 w-4" />
          <span className="hidden sm:inline">{currentStoreName}</span>
          <span className="mx-1">•</span>
          <MonitorDot className="h-4 w-4" />
          <span className="hidden sm:inline">{currentRegisterLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Store & Register</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Store</label>
            <Select value={selStore ?? ""} onValueChange={(v) => { setSelStore(v); setSelRegister(null) }}>
              <SelectTrigger><SelectValue placeholder="Choose a store" /></SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Register</label>
            <Select disabled={!selStore} value={selRegister ?? ""} onValueChange={(v) => setSelRegister(v)}>
              <SelectTrigger><SelectValue placeholder="Choose a register" /></SelectTrigger>
              <SelectContent>
                {regsForStore.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!canSave}
              onClick={() => {
                if (selStore && selRegister) {
                  onChange({ storeId: selStore, registerId: selRegister })
                  setOpen(false)
                }
              }}
            >
              Use this register
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
