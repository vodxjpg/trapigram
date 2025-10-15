// src/app/(dashboard)/pos/components/store-register-selector.tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Building2, MonitorDot, Store } from "lucide-react"

type Store = { id: string; name: string }
type Outlet = { id: string; name: string; storeId: string }

type Props = {
  storeId: string | null
  outletId: string | null
  onChange: (p: { storeId: string; outletId: string }) => void
  /** If true, the dialog opens and can't be dismissed until both chosen. */
  forceOpen?: boolean
}

export function StoreRegisterSelector({
  storeId,
  outletId,
  onChange,
  forceOpen = false,
}: Props) {
  const [open, setOpen] = useState(false)
  const [stores, setStores] = useState<Store[]>([])
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [selStore, setSelStore] = useState<string | null>(storeId)
  const [selOutlet, setSelOutlet] = useState<string | null>(outletId)

  // Keep local selection in sync with external props
  useEffect(() => {
    setSelStore(storeId)
    setSelOutlet(outletId)
  }, [storeId, outletId])

  // Load stores once
  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch("/api/pos/stores")
        const json = await res.json()
        if (!ignore) setStores(json.stores || [])
      } catch (e) {
        console.error("load stores", e)
      }
    })()
    return () => {
      ignore = true
    }
  }, [])

  // Load registers for the selected store
  useEffect(() => {
    if (!selStore) return
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pos/registers?storeId=${encodeURIComponent(selStore)}`)
        const json = await res.json()

        // Map to { id, name, storeId } and hide inactive registers
        const mapped: Outlet[] = (json.registers || [])
          .filter((r: any) => r.active !== false) // safety: default treat missing as active
          .map((x: any) => ({
            id: x.id,
            name: x.name, // 👈 use `name` (NOT `label`)
            storeId: x.storeId,
          }))

        if (!ignore) setOutlets(mapped)
      } catch (e) {
        console.error("load outlets", e)
      }
    })()
    return () => {
      ignore = true
    }
  }, [selStore])

  // Only show outlets for the selected store
  const outletsForStore = useMemo(
    () => outlets.filter((r) => r.storeId === selStore),
    [outlets, selStore]
  )

  // If there is exactly one outlet for this store, pick it automatically
  useEffect(() => {
    if (!selStore) return
    if (outletsForStore.length === 1) {
      setSelOutlet(outletsForStore[0].id)
    }
  }, [selStore, outletsForStore])

  // Force the dialog open on first-run until both are chosen
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const currentStoreName =
    stores.find((s) => s.id === storeId)?.name || "Select store"
  const currentOutletName =
    outlets.find((r) => r.id === outletId)?.name || "Select outlet"

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
          <span className="hidden sm:inline">{currentOutletName}</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Store &amp; Outlet</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Store */}
          <div>
            <label className="mb-2 block text-sm font-medium">Store</label>
            <Select
              value={selStore ?? ""}
              onValueChange={(v) => {
                setSelStore(v)
                setSelOutlet(null) // reset outlet when store changes
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose a store" />
              </SelectTrigger>
              <SelectContent>
                {stores.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4" /> {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Outlet */}
          <div>
            <label className="mb-2 block text-sm font-medium">Outlet</label>
            <Select
              disabled={!selStore}
              value={selOutlet ?? ""}
              onValueChange={(v) => setSelOutlet(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Choose an outlet" />
              </SelectTrigger>
              <SelectContent>
                {outletsForStore.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2">
            {!forceOpen && (
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
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
