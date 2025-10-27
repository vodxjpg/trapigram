// src/app/(dashboard)/pos/components/pos-interface.tsx
"use client"

import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { ProductGrid, type GridProduct } from "./product-grid"
import { Cart } from "./cart"
import { CategoryNav } from "./category-nav"
import { CustomerSelector, type Customer } from "./customer-selector"
import { CheckoutDialog } from "./checkout-dialog"
import ReceiptOptionsDialog from "./receipt-options-dialog"
import { Search, ShoppingCart } from "lucide-react"
import { Input } from "@/components/ui/input"
import { StoreRegisterSelector } from "./store-register-selector"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from "@/components/ui/sheet"

type Category = { id: string; name: string; parentId: string | null }

const LS_KEYS = {
  STORE: "pos.storeId",
  OUTLET: "pos.outletId",
  CART: (outletId: string) => `pos.cartId.${outletId}`,
  CLIENT: "pos.clientId",
}

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

type CartLine = {
  productId: string
  variationId: string | null
  title: string
  image: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  subtotal: number
}

export function POSInterface() {
  // store/outlet
  const [storeId, setStoreId] = useState<string | null>(null)
  const [outletId, setOutletId] = useState<string | null>(null)

  // store/org meta used to resolve country for carts
  const [storeCountry, setStoreCountry] = useState<string | null>(null)
  const [orgCountries, setOrgCountries] = useState<string[]>([])

  // catalog
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<GridProduct[]>([])
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const debouncedSearch = useDebounced(searchQuery, 200)

  // cart
  const [cartId, setCartId] = useState<string | null>(null)
  const [lines, setLines] = useState<CartLine[]>([])
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creatingCartRef = useRef(false)

  // track which product tiles are currently “adding…”
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set())

  // mobile cart drawer
  const [cartSheetOpen, setCartSheetOpen] = useState(false)

  // POS discount (coupon "POS")
  const [discountType, setDiscountType] = useState<"fixed" | "percentage">("fixed")
  const [discountValue, setDiscountValue] = useState<string>("")

  // post-checkout receipt dialog
  const [receiptDlg, setReceiptDlg] = useState<{ orderId: string; email: string | null } | null>(null)

  // restore persisted choices
  useEffect(() => {
    if (typeof window === "undefined") return
    const s = localStorage.getItem(LS_KEYS.STORE)
    const r = localStorage.getItem(LS_KEYS.OUTLET)
    if (s) setStoreId(s)
    if (r) setOutletId(r)
  }, [])

  // fetch org allowed countries (for fallback)
  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch("/api/organizations/countries", {
          headers: { "x-internal-secret": process.env.NEXT_PUBLIC_INTERNAL_API_SECRET || "" },
        })
        if (!res.ok) return
        const j = await res.json()
        const list: string[] = Array.isArray(j.countries)
          ? j.countries
          : JSON.parse(j.countries || "[]")
        if (!ignore) setOrgCountries(list)
      } catch {/* ignore */ }
    })()
    return () => { ignore = true }
  }, [])

  // load store meta when store changes (to get address.country)
  useEffect(() => {
    if (!storeId) {
      setStoreCountry(null)
      return
    }
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pos/stores/${storeId}`)
        if (!res.ok) return
        const j = await res.json()
        const c = j.store?.address?.country ?? null
        if (!ignore) setStoreCountry(c || null)
      } catch {/* ignore */ }
    })()
    return () => { ignore = true }
  }, [storeId])

  // Try restoring a previously selected customer by id
  useEffect(() => {
    if (typeof window === "undefined") return
    const id = localStorage.getItem(LS_KEYS.CLIENT)
    if (!id) return
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/clients/${id}`)
        if (ignore) return
        if (res.ok) {
          const j = await res.json()
          const c = j.client ?? j
          if (c?.id) {
            setSelectedCustomer({
              id: c.id,
              name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || "Customer",
              email: c.email ?? null,
              phone: c.phoneNumber ?? null,
            })
            return
          }
        }
      } catch {/* ignore */ }
    })()
    return () => { ignore = true }
  }, [])

  // Reset cart whenever the selected customer changes
  useEffect(() => {
    if (!outletId) return
    if (typeof window !== "undefined") {
      localStorage.removeItem(LS_KEYS.CART(outletId))
    }
    setCartId(null)
    setLines([])
  }, [selectedCustomer?.id])

  // require store→outlet selection
  const forceSelectDialog = !storeId || !outletId

  // When outlet changes, restore its cart if any
  useEffect(() => {
    if (!outletId) {
      setCartId(null)
      setLines([])
      return
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.OUTLET, outletId)
      const savedCartId = localStorage.getItem(LS_KEYS.CART(outletId))
      if (savedCartId) {
        setCartId(savedCartId)
        refreshCart(savedCartId)
      } else {
        setCartId(null)
        setLines([])
      }
    }
  }, [outletId])

  // fetch categories
  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch("/api/product-categories?all=1").then(r => r.json())
        if (ignore) return
        const cats: Category[] = (res.categories || []).map((c: any) => ({
          id: String(c.id),
          name: c.name,
          parentId: c.parentId ? String(c.parentId) : null,
        }))
        setCategories(cats)
      } catch { }
    })()
    return () => { ignore = true }
  }, [])

  // helper: normalize product category IDs to string[]
  const normalizeCatIds = (p: any): string[] => {
    const raw = p?.categoryIds ?? p?.categories ?? []
    if (!Array.isArray(raw)) return []
    return raw
      .map((v: any) => {
        if (v == null) return null
        if (typeof v === "string" || typeof v === "number") return String(v)
        if (typeof v === "object") return v.id ? String(v.id) : null
        return null
      })
      .filter((x: any): x is string => !!x)
  }

  // fetch products (flat variations)
  useEffect(() => {
    let ignore = false
    const params = new URLSearchParams({ pageSize: "200", page: "1" })
    if (debouncedSearch) params.set("search", debouncedSearch)
    ;(async () => {
      try {
        const res = await fetch(`/api/products?${params}`).then(r => r.json())
        if (ignore) return
        const flat = (res.productsFlat || []).map((p: any) => {
          const price = p.maxSalePrice ?? p.maxRegularPrice ?? 0
          return {
            id: String(p.id),
            productId: String(p.productId),
            variationId: p.variationId ? String(p.variationId) : null,
            title: p.title,
            image: p.image ?? null,
            categoryIds: normalizeCatIds(p),
            priceForDisplay: Number(price) || 0,
          } as GridProduct
        })
        setProducts(flat)
      } catch {/* ignore */ }
    })()
    return () => { ignore = true }
  }, [debouncedSearch])

  // DEFAULT: ensure Walk-in exists & selected
  useEffect(() => {
    let ignore = false
    const ensureWalkIn = async () => {
      if (selectedCustomer) return
      try {
        const url = new URL("/api/clients", window.location.origin)
        url.searchParams.set("page", "1")
        url.searchParams.set("pageSize", "1")
        url.searchParams.set("search", "Walk-in")
        const res = await fetch(url.toString())
        let picked: Customer | null = null
        if (res.ok) {
          const j = await res.json()
          const c = (j.clients || [])[0]
          if (c) {
            picked = {
              id: c.id,
              name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || "Walk-in",
              email: c.email ?? null,
              phone: c.phoneNumber ?? null,
            }
          }
        }
        if (!picked) {
          const r = await fetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              username: `walkin-${Date.now()}`,
              firstName: "Walk-in",
              lastName: "Customer",
              email: null,
              phoneNumber: null,
              country: null,
            }),
          })
          if (!r.ok) {
            const e = await r.json().catch(() => ({}))
            throw new Error(e?.error || "Failed to create walk-in client.")
          }
          const c = await r.json()
          picked = { id: c.id, name: "Walk-in", email: null, phone: null }
        }
        if (!ignore && picked) {
          setSelectedCustomer(picked)
          if (typeof window !== "undefined") localStorage.setItem(LS_KEYS.CLIENT, picked.id)
        }
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to prepare walk-in customer.")
      }
    }
    ensureWalkIn()
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCustomer])

  // Category helpers
  const parentById = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const c of categories) m.set(c.id, c.parentId ? String(c.parentId) : null)
    return m
  }, [categories])

  const productMatchesCategory = (prodCatIds: string[], sel: string | null) => {
    if (sel === null) return true
    for (const cid of prodCatIds) {
      let cur: string | null = cid
      while (cur) {
        if (cur === sel) return true
        cur = parentById.get(cur) ?? null
      }
    }
    return false
  }

  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return products.filter(p => {
      const matchesCategory = productMatchesCategory(p.categoryIds, selectedCategoryId)
      const matchesSearch = !q || p.title.toLowerCase().includes(q)
      return matchesCategory && matchesSearch
    })
  }, [products, selectedCategoryId, debouncedSearch, parentById])

  // totals (client-side estimate for cart UI)
  const subtotalEstimate = useMemo(() => lines.reduce((s, l) => s + l.subtotal, 0), [lines])
  const discountAmount = useMemo(() => {
    const v = Number(discountValue)
    if (!Number.isFinite(v) || v <= 0) return 0
    if (discountType === "percentage") {
      const pct = Math.max(0, Math.min(100, v))
      return +(subtotalEstimate * (pct / 100)).toFixed(2)
    }
    return +Math.min(subtotalEstimate, Math.max(0, v)).toFixed(2)
  }, [discountType, discountValue, subtotalEstimate])
  const totalEstimate = Math.max(0, +(subtotalEstimate - discountAmount).toFixed(2))

  const itemCount = useMemo(() => lines.reduce((n, l) => n + (l.quantity || 0), 0), [lines])

  const resolveCartCountry = () => storeCountry || orgCountries[0] || "US"

  const titleFor = useCallback((pid: string, vid: string | null, fallback: string) => {
    const m = products.find(p => p.productId === pid && p.variationId === (vid ?? null));
    return m?.title || fallback;
  }, [products]);

  const productKeyOf = (p: GridProduct) => `${p.productId}:${p.variationId ?? "base"}`

  const ensureCart = async (clientId: string) => {
    if (cartId || creatingCartRef.current) return cartId
    if (!storeId || !outletId) {
      setError("Please select a store and outlet before adding items.")
      return null
    }
    creatingCartRef.current = true
    try {
      const idem = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const body = {
        clientId,
        country: resolveCartCountry(),
        storeId,
        registerId: outletId,
      }
      const res = await fetch("/api/pos/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem as string },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e?.error || "Failed to create cart")
      }
      const data = await res.json()
      const newCartId = data?.newCart?.id || data?.cart?.id || data?.id
      if (!newCartId) throw new Error("No cart id returned")
      setCartId(newCartId)
      if (outletId && typeof window !== "undefined") {
        localStorage.setItem(LS_KEYS.CART(outletId), newCartId)
      }
      return newCartId
    } finally {
      creatingCartRef.current = false
    }
  }

  const refreshCart = async (cid: string) => {
    try {
      const res = await fetch(`/api/cart/${cid}`)
      if (!res.ok) return
      const j = await res.json()
      const list: any[] = j.lines || j.resultCartProducts || []
      setLines(list.map((l) => ({
        productId: l.id,
        variationId: l.variationId ?? null,
        title: titleFor(l.id, l.variationId ?? null, l.title),
        image: l.image ?? null,
        sku: l.sku ?? null,
        quantity: Number(l.quantity),
        unitPrice: Number(l.unitPrice),
        subtotal: Number(l.subtotal),
      })))
    } catch (e: any) {
      setError(e?.message || "Failed to refresh cart.")
    }
  }

  const addToCart = async (p: GridProduct) => {
    try {
      if (!selectedCustomer?.id) {
        setError("Pick or create a customer first (Walk-in is fine).")
        return
      }

      const key = productKeyOf(p)
      if (addingKeys.has(key)) return
      setAddingKeys(prev => {
        const next = new Set(prev)
        next.add(key)
        return next
      })

      const cid = await ensureCart(selectedCustomer.id)
      if (!cid) return

      const idem = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const res = await fetch(`/api/pos/cart/${cid}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem as string },
        body: JSON.stringify({
          productId: p.productId,
          variationId: p.variationId,
          quantity: 1,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j?.error || "Failed to add to cart")
        return
      }

      if (Array.isArray(j.lines)) {
        setLines(j.lines.map((l: any) => ({
          productId: l.id,
          variationId: l.variationId ?? null,
          title: titleFor(l.id, l.variationId ?? null, l.title),
          image: l.image ?? null,
          sku: l.sku ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.subtotal),
        })))
        return
      }

      await refreshCart(cid)
    } catch (e: any) {
      setError(e?.message || "Failed to add to cart.")
    } finally {
      const key = productKeyOf(p)
      setAddingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  const inc = async (line: CartLine) => {
    if (!cartId) return
    const res = await fetch(`/api/pos/cart/${cartId}/update-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: line.productId,
        variationId: line.variationId,
        action: "add",
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j?.error || "Failed to update quantity"); return }
    setLines((j.lines || []).map((l: any) => ({
      productId: l.id,
      variationId: l.variationId ?? null,
      title: titleFor(l.id, l.variationId ?? null, l.title),
      image: l.image ?? null,
      sku: l.sku ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })))
  }

  const dec = async (line: CartLine) => {
    if (!cartId) return
    const res = await fetch(`/api/pos/cart/${cartId}/update-product`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: line.productId,
        variationId: line.variationId,
        action: "subtract",
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j?.error || "Failed to update quantity"); return }
    setLines((j.lines || []).map((l: any) => ({
      productId: l.id,
      variationId: l.variationId ?? null,
      title: titleFor(l.id, l.variationId ?? null, l.title),
      image: l.image ?? null,
      sku: l.sku ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })))
  }

  const removeLine = async (line: CartLine) => {
    if (!cartId) return
    const res = await fetch(`/api/pos/cart/${cartId}/remove-product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: line.productId,
        variationId: line.variationId,
      }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { setError(j?.error || "Failed to remove item"); return }
    setLines((j.lines || []).map((l: any) => ({
      productId: l.id,
      variationId: l.variationId ?? null,
      title: titleFor(l.id, l.variationId ?? null, l.title),
      image: l.image ?? null,
      sku: l.sku ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    })))
  }

  const onCompleteCheckout = (orderId: string, parked?: boolean) => {
    if (outletId && typeof window !== "undefined") {
      localStorage.removeItem(LS_KEYS.CART(outletId))
    }
    setCartId(null)
    setLines([])

    if (!parked) {
      setReceiptDlg({ orderId, email: selectedCustomer?.email ?? null })
    }
  }

  const setStoreOutlet = ({ storeId: s, outletId: o }: { storeId: string; outletId: string }) => {
    setStoreId(s)
    setOutletId(o)
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.STORE, s)
      localStorage.setItem(LS_KEYS.OUTLET, o)
    }
  }

  return (
    <>
      <div className="flex h-screen flex-col bg-background">
        {/* Header */}
        <header className="flex items-center justify-between border-b bg-card px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">POS</h1>
            <div className="relative w-full max-w-xs md:w-80">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <StoreRegisterSelector
              storeId={storeId}
              outletId={outletId}
              onChange={setStoreOutlet}
              forceOpen={forceSelectDialog}
            />
            <CustomerSelector
              selectedCustomer={selectedCustomer}
              onSelectCustomer={(c) => {
                setSelectedCustomer(c)
                if (typeof window !== "undefined") {
                  if (c?.id) localStorage.setItem(LS_KEYS.CLIENT, c.id)
                  else localStorage.removeItem(LS_KEYS.CLIENT)
                }
              }}
            />
          </div>
        </header>

        {/* Main Content */}
        <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
          {/* Products */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <CategoryNav
              categories={categories.map(c => ({ id: c.id, name: c.name }))}
              selectedCategoryId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />
            <ProductGrid
              products={filteredProducts}
              onAddToCart={addToCart}
              addingKeys={addingKeys}
            />
          </div>

          {/* Cart sidebar (desktop / landscape) */}
          <div className="hidden lg:flex">
            <Cart
              variant="inline"
              lines={lines}
              onInc={inc}
              onDec={dec}
              onRemove={removeLine}
              onCheckout={() => setCheckoutOpen(true)}
              discountType={discountType}
              discountValue={discountValue}
              onDiscountType={setDiscountType}
              onDiscountValue={(val) => {
                const sanitized = val.replace(/^0+(?=\d)(?!\.)/, "")
                setDiscountValue(sanitized)
              }}
              subtotal={subtotalEstimate}
              discountAmount={discountAmount}
              total={totalEstimate}
            />
          </div>
        </div>

        {/* Mobile bottom bar → opens cart drawer */}
        <div className="lg:hidden sticky bottom-0 inset-x-0 border-t bg-card p-3">
          <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
            <SheetTrigger asChild>
              <button className="flex w-full items-center justify-between rounded-md bg-primary px-4 py-3 text-primary-foreground">
                <span className="flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4" />
                  Cart • {itemCount}
                </span>
                <span>${totalEstimate.toFixed(2)}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[85vh] p-0 rounded-t-2xl">
              <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />
              <SheetHeader className="sr-only">
                <SheetTitle>Cart</SheetTitle>
              </SheetHeader>

              <div className="flex h-[calc(85vh-0.75rem)] flex-col">
                <Cart
                  variant="sheet"
                  lines={lines}
                  onInc={inc}
                  onDec={dec}
                  onRemove={removeLine}
                  onCheckout={() => {
                    setCartSheetOpen(false)
                    setCheckoutOpen(true)
                  }}
                  discountType={discountType}
                  discountValue={discountValue}
                  onDiscountType={setDiscountType}
                  onDiscountValue={(val) => {
                    const sanitized = val.replace(/^0+(?=\d)(?!\.)/, "")
                    setDiscountValue(sanitized)
                  }}
                  subtotal={subtotalEstimate}
                  discountAmount={discountAmount}
                  total={totalEstimate}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>

        {/* Checkout Dialog */}
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          totalEstimate={totalEstimate}
          cartId={cartId}
          clientId={selectedCustomer?.id ?? null}
          registerId={outletId}
          storeId={storeId}
          onComplete={onCompleteCheckout}
          discount={{
            type: discountType,
            value: Number(discountValue || 0)
          }}
        />
      </div>

      {/* Post-checkout: receipt options */}
      <ReceiptOptionsDialog
        open={!!receiptDlg}
        onOpenChange={(o) => !o && setReceiptDlg(null)}
        orderId={receiptDlg?.orderId ?? null}
        defaultEmail={receiptDlg?.email ?? ""}
      />

      {/* Error dialog */}
      <AlertDialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Something went wrong</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="text-sm text-muted-foreground">{error}</div>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setError(null)}>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
