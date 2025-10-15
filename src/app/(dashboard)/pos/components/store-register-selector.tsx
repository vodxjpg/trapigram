"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, MonitorDot, Store } from "lucide-react"

type Store = { id: string; name: string }
type Outlet = { id: string; label: string; storeId: string }

type Props = {
  storeId: string | null
  outletId: string | null
  onChange: (p: { storeId: string; outletId: string }) => void
  /** If true, the dialog opens and can't be dismissed until both chosen. */
  forceOpen?: boolean
}

export function StoreRegisterSelector({ storeId, outletId, onChange, forceOpen = false }: Props) {
  const [open, setOpen] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [selStore, setSelStore] = useState<string | null>(storeId)
  const [selOutlet, setSelOutlet] = useState<string | null>(outletId)

  const outletsForStore = useMemo(
    () => outlets.filter(r => r.storeId === selStore),
    [outlets, selStore]
  )

  useEffect(() => {
    setSelStore(storeId)
    setSelOutlet(outletId)
  }, [storeId, outletId])

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
        if (!ignore) setOutlets((r.registers || []).map((x: any) => ({ id: x.id, label: x.label, storeId: x.storeId })))
      } catch (e) {
        console.error("load outlets", e)
      }
    })()
    return () => { ignore = true }
  }, [selStore])

  // Force the dialog open during first-run
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const currentStoreName = stores.find(s => s.id === storeId)?.name || "Select store"
  const currentOutletLabel = outlets.find(r => r.id === outletId)?.label || "Select outlet"

  const canSave = Boolean(selStore && selOutlet)

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (forceOpen && o === false && !(selStore && selOutlet)) {
          // Block closing until both are selected
          return
        }
        setOpen(o)
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <Store className="h-4 w-4" />
          <span className="hidden sm:inline">{currentStoreName}</span>
          <span className="mx-1">•</span>
          <MonitorDot className="h-4 w-4" />
          <span className="hidden sm:inline">{currentOutletLabel}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Store & Outlet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium">Store</label>
            <Select value={selStore ?? ""} onValueChange={(v) => { setSelStore(v); setSelOutlet(null) }}>
              <SelectTrigger><SelectValue placeholder="Choose a store" /></SelectTrigger>
              <SelectContent>
                {stores.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" /> {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Outlet</label>
            <Select disabled={!selStore} value={selOutlet ?? ""} onValueChange={(v) => setSelOutlet(v)}>
              <SelectTrigger><SelectValue placeholder="Choose an outlet" /></SelectTrigger>
              <SelectContent>
                {outletsForStore.map(r => (
                  <SelectItem key={r.id} value={r.id}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            {!forceOpen && (
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            )}
            <Button
              disabled={!canSave}
              onClick={() => {
                if (selStore && selOutlet) {
                  onChange({ storeId: selStore, outletId: selOutlet })
                  setOpen(false)
                }
              }}
            >
              Use this outlet
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
