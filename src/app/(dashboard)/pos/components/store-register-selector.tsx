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
type Outlet = { id: string; name: string; storeId: string; active?: boolean }

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
  const [storesLoaded, setStoresLoaded] = useState(false)
  const [outlets, setOutlets] = useState<Outlet[]>([])
  const [outletsLoaded, setOutletsLoaded] = useState(false)
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
      } finally {
        if (!ignore) setStoresLoaded(true)
      }
    })()
    return () => { ignore = true }
  }, [])

  // ⛳️ Preselect first store when none chosen
  useEffect(() => {
    if (!storesLoaded) return
    if (!selStore && stores.length > 0) {
      setSelStore(stores[0].id)
      setSelOutlet(null) // reset outlet so we can load fresh for this store
    }
  }, [storesLoaded, stores, selStore])

  // Load registers for the selected store
  useEffect(() => {
    if (!selStore) { setOutlets([]); setOutletsLoaded(false); return }
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pos/registers?storeId=${encodeURIComponent(selStore)}`)
        const json = await res.json()
        const mapped: Outlet[] = (json.registers || [])
          .filter((r: any) => r.active !== false)
          .map((x: any) => ({
            id: x.id,
            name: x.name ?? x.label ?? "Register",
            storeId: x.storeId,
            active: x.active,
          }))
        if (!ignore) setOutlets(mapped)
      } catch (e) {
        console.error("load outlets", e)
      } finally {
        if (!ignore) setOutletsLoaded(true)
      }
    })()
    return () => { ignore = true }
  }, [selStore])

  const outletsForStore = useMemo(
    () => outlets.filter((r) => r.storeId === selStore),
    [outlets, selStore]
  )

  // ⛳️ Preselect first outlet for the store (if any) when none chosen
  useEffect(() => {
    if (!selStore || !outletsLoaded) return
    if (!selOutlet && outletsForStore.length > 0) {
      setSelOutlet(outletsForStore[0].id)
    }
  }, [selStore, selOutlet, outletsLoaded, outletsForStore])

  // Force the dialog open on first-run until both are chosen
  useEffect(() => {
    if (forceOpen) setOpen(true)
  }, [forceOpen])

  const currentStoreName =
    stores.find((s) => s.id === storeId)?.name || "Select store"
  const currentOutletName =
    outletsForStore.find((r) => r.id === outletId)?.name ||
    outlets.find((r) => r.id === outletId)?.name ||
    "Select outlet"

  const canSave = Boolean(selStore && selOutlet)

  // Helpers to open pages in a new tab
  const openStoresPage = () => window.open("/stores", "_blank", "noopener,noreferrer")
  const openStoreDetail = (id: string) => window.open(`/stores/${id}`, "_blank", "noopener,noreferrer")

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (forceOpen && o === false && !(selStore && selOutlet)) return
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
          {/* Empty state: NO STORES */}
          {storesLoaded && stores.length === 0 ? (
            <div className="rounded-md border p-4 bg-muted/30">
              <div className="text-sm">
                You don’t have any <strong>stores</strong> yet. POS requires at least one store and one register.
              </div>
              <div className="mt-3">
                <Button onClick={openStoresPage}>
                  Create a store
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* Store */}
              <div className="w-full">
                <label className="mb-2 block text-sm font-medium">Store</label>
                <Select
                  value={selStore ?? ""}
                  onValueChange={(v) => {
                    setSelStore(v)
                    setSelOutlet(null) // reset outlet when store changes
                  }}
                >
                  <SelectTrigger className="w-full">
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
              <div className="w-full">
                <label className="mb-2 block text-sm font-medium">Outlet</label>
                <Select
                  disabled={!selStore}
                  value={selOutlet ?? ""}
                  onValueChange={(v) => setSelOutlet(v)}
                >
                  <SelectTrigger className="w-full">
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

                {/* Empty state: NO REGISTERS FOR STORE */}
                {selStore && outletsLoaded && outletsForStore.length === 0 && (
                  <div className="mt-3 rounded-md border p-3 bg-muted/30 text-sm">
                    No <strong>registers</strong> found for this store.
                    <div className="mt-2">
                      <Button variant="outline" onClick={() => openStoreDetail(selStore)}>
                        Open this store to add a register (new tab)
                      </Button>
                    </div>
                  </div>
                )}
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
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
