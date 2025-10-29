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
  SheetTitle
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
  const linesRef = useRef<CartLine[]>([])
  useEffect(() => { linesRef.current = lines }, [lines])

  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const creatingCartRef = useRef(false)

  // product-tile quick spinner (non-blocking)
  const [addingKeys, setAddingKeys] = useState<Set<string>>(new Set())

  // cart line pending spinner keys (non-blocking for +/-)
  const [pendingLineKeys, setPendingLineKeys] = useState<Set<string>>(new Set())

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

  // load store meta
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

  // When outlet changes, persist choice and clear any cached cart id
  useEffect(() => {
    if (!outletId) {
      setCartId(null)
      setLines([])
      return
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.OUTLET, outletId)
      localStorage.removeItem(LS_KEYS.CART(outletId))
    }
    setCartId(null)
    setLines([])
  }, [outletId])

  // After outlet + store + customer are known → open a clean cart for Walk-in
  useEffect(() => {
    const openFreshCartIfNeeded = async () => {
      if (!storeId || !outletId || !selectedCustomer?.id) return
      try {
        const idem = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
        const body = {
          clientId: selectedCustomer.id,
          country: resolveCartCountry(),
          storeId,
          registerId: outletId,
          resetIfWalkIn: true,
        }
        const res = await fetch("/api/pos/cart", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idem as string },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || "Failed to prepare cart")
        }
        const newCartId = data?.newCart?.id || data?.cart?.id || data?.id
        if (!newCartId) throw new Error("No cart id returned")
        setCartId(newCartId)
        setLines([]) // start clean
        if (typeof window !== "undefined") {
          localStorage.setItem(LS_KEYS.CART(outletId), newCartId)
        }
      } catch (e: any) {
        setError(e?.message || "Failed to prepare POS cart.")
      }
    }
    void openFreshCartIfNeeded()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, outletId, selectedCustomer?.id])

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
  const lineKeyOf = (l: {productId: string; variationId: string | null}) => `${l.productId}:${l.variationId ?? "base"}`

  /** Map server lines → UI lines */
  const mapServerLines = useCallback((list: any[]) => {
    return list.map((l) => ({
      productId: l.id,
      variationId: l.variationId ?? null,
      title: titleFor(l.id, l.variationId ?? null, l.title),
      image: l.image ?? null,
      sku: l.sku ?? null,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unitPrice),
      subtotal: Number(l.subtotal),
    } as CartLine))
  }, [titleFor])

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
      setLines(mapServerLines(list))
    } catch (e: any) {
      setError(e?.message || "Failed to refresh cart.")
    }
  }

  /** ---------- Optimistic helpers ---------- */

  const upsertOptimistic = (p: GridProduct) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l.productId === p.productId && (l.variationId ?? null) === (p.variationId ?? null))
      if (idx >= 0) {
        const unitPrice = Number(prev[idx].unitPrice ?? p.priceForDisplay ?? 0)
        const quantity = prev[idx].quantity + 1
        const subtotal = +(quantity * unitPrice).toFixed(2)
        const updated = { ...prev[idx], quantity, unitPrice, subtotal }
        const next = prev.slice()
        next[idx] = updated
        return next
      }
      const unitPrice = Number(p.priceForDisplay || 0)
      const line: CartLine = {
        productId: p.productId,
        variationId: p.variationId ?? null,
        title: p.title,
        image: p.image ?? null,
        sku: null,
        quantity: 1,
        unitPrice,
        subtotal: +unitPrice.toFixed(2),
      }
      return [line, ...prev]
    })
  }

  const optimisticInc = (line: CartLine) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l.productId === line.productId && (l.variationId ?? null) === (line.variationId ?? null))
      if (idx === -1) return prev
      const unitPrice = Number(prev[idx].unitPrice)
      const quantity = prev[idx].quantity + 1
      const subtotal = +(quantity * unitPrice).toFixed(2)
      const next = prev.slice()
      next[idx] = { ...prev[idx], quantity, subtotal }
      return next
    })
  }

  const optimisticDec = (line: CartLine) => {
    setLines(prev => {
      const idx = prev.findIndex(l => l.productId === line.productId && (l.variationId ?? null) === (line.variationId ?? null))
      if (idx === -1) return prev
      const unitPrice = Number(prev[idx].unitPrice)
      const quantity = Math.max(0, prev[idx].quantity - 1)
      if (quantity === 0) {
        const next = prev.slice()
        next.splice(idx, 1)
        return next
      }
      const subtotal = +(quantity * unitPrice).toFixed(2)
      const next = prev.slice()
      next[idx] = { ...prev[idx], quantity, subtotal }
      return next
    })
  }

  const optimisticRemove = (line: CartLine) => {
    setLines(prev => prev.filter(l => !(l.productId === line.productId && (l.variationId ?? null) === (line.variationId ?? null))))
  }

  /** ---------- Micro-batched "add to cart" queue (per product tile) ---------- */

  type PendingAdd = { pending: number; inflight: boolean; flushTimer: number | null }
  const addQueueRef = useRef<Map<string, PendingAdd>>(new Map())

  const scheduleAddFlush = (key: string, product: GridProduct) => {
    const entry = addQueueRef.current.get(key)!
    if (entry.flushTimer != null) return
    entry.flushTimer = window.setTimeout(() => {
      entry.flushTimer = null
      void flushAddKey(key, product)
    }, 0)
  }

  const flushAddKey = async (key: string, p: GridProduct) => {
    const entry = addQueueRef.current.get(key)
    if (!entry || entry.inflight || entry.pending <= 0) return

    entry.inflight = true
    const qty = entry.pending
    entry.pending = 0

    try {
      const clientId = selectedCustomer?.id
      if (!clientId) { setError("Pick or create a customer first (Walk-in is fine)."); entry.inflight = false; return }
      const cid = (await ensureCart(clientId)) || cartId
      if (!cid) { entry.inflight = false; return }

      const idem = (globalThis.crypto as any)?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`

      // Try coalesced quantity call
      let ok = false
      let linesPayload: any[] | null = null
      try {
        const res = await fetch(`/api/pos/cart/${cid}/add-product`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": idem as string },
          body: JSON.stringify({
            productId: p.productId,
            variationId: p.variationId,
            quantity: qty,
          }),
        })
        const j = await res.json().catch(() => ({}))
        ok = res.ok
        if (ok && Array.isArray(j.lines)) linesPayload = j.lines
      } catch { ok = false }

      if (!ok) {
        for (let i = 0; i < qty; i++) {
          const res2 = await fetch(`/api/pos/cart/${cid}/add-product`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: p.productId,
              variationId: p.variationId,
              quantity: 1,
            }),
          })
          if (!res2.ok) {
            const errPayload = await res2.json().catch(() => ({}))
            setError(errPayload?.error || "Failed to add to cart")
            await refreshCart(cid)
            break
          }
          const j2 = await res2.json().catch(() => ({}))
          if (Array.isArray(j2.lines)) linesPayload = j2.lines
        }
      }

      if (linesPayload) setLines(mapServerLines(linesPayload))
      else await refreshCart(cid)
    } catch (e: any) {
      setError(e?.message || "Failed to add to cart.")
      if (cartId) await refreshCart(cartId)
    } finally {
      entry.inflight = false
      if (entry.pending > 0) scheduleAddFlush(key, p)
    }
  }

  /** ---------- NEW: Micro-batched +/- queue per cart line ---------- */

  type LineDelta = { delta: number; inflight: boolean; flushTimer: number | null }
  const lineQueueRef = useRef<Map<string, LineDelta>>(new Map())

  const setPendingKey = (key: string, on: boolean) => {
    setPendingLineKeys(prev => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }

  const scheduleLineFlush = (key: string, payload: { productId: string; variationId: string | null }) => {
    const entry = lineQueueRef.current.get(key)!
    if (entry.flushTimer != null) return
    // micro-batch next tick
    entry.flushTimer = window.setTimeout(() => {
      entry.flushTimer = null
      void flushLineKey(key, payload)
    }, 0)
  }

  const flushLineKey = async (key: string, payload: { productId: string; variationId: string | null }) => {
    const entry = lineQueueRef.current.get(key)
    if (!entry || entry.inflight || entry.delta === 0) return

    entry.inflight = true
    const deltaNow = entry.delta
    entry.delta = 0
    setPendingKey(key, true)

    try {
      const cid = cartId
      if (!cid) { entry.inflight = false; setPendingKey(key, false); return }

      const qtyAbs = Math.abs(deltaNow)
      const action = deltaNow > 0 ? "add" : "subtract"

      let ok = false
      let linesPayload: any[] | null = null

      // Try coalesced PATCH with quantity first
      try {
        const res = await fetch(`/api/pos/cart/${cid}/update-product`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: payload.productId,
            variationId: payload.variationId,
            action,
            quantity: qtyAbs,            // <-- if supported, one call
          }),
        })
        const j = await res.json().catch(() => ({}))
        ok = res.ok
        if (ok && Array.isArray(j.lines)) linesPayload = j.lines
      } catch { ok = false }

      // Fallback to qtyAbs × single-step calls
      if (!ok) {
        for (let i = 0; i < qtyAbs; i++) {
          const res2 = await fetch(`/api/pos/cart/${cid}/update-product`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              productId: payload.productId,
              variationId: payload.variationId,
              action,
            }),
          })
          if (!res2.ok) {
            const j2e = await res2.json().catch(() => ({}))
            setError(j2e?.error || "Failed to update quantity")
            await refreshCart(cid)
            break
          }
          const j2 = await res2.json().catch(() => ({}))
          if (Array.isArray(j2.lines)) linesPayload = j2.lines
        }
      }

      if (linesPayload) setLines(mapServerLines(linesPayload))
      else await refreshCart(cid)
    } catch (e: any) {
      setError(e?.message || "Failed to update quantity")
      if (cartId) await refreshCart(cartId)
    } finally {
      entry.inflight = false
      // keep spinner if more clicks landed
      if (entry.delta !== 0) {
        scheduleLineFlush(key, payload)
      } else {
        setPendingKey(key, false)
      }
    }
  }

  /** ---------- Actions ---------- */

  const TILE_SPINNER_MS = 120 // short, non-blocking visual ping
  const addToCart = async (p: GridProduct) => {
    // instant optimistic
    upsertOptimistic(p)

    // tiny visual ping
    const key = productKeyOf(p)
    setAddingKeys(prev => new Set(prev).add(key))
    window.setTimeout(() => {
      setAddingKeys(prev => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }, TILE_SPINNER_MS)

    // enqueue micro-batched network call
    const map = addQueueRef.current
    const entry = map.get(key) ?? { pending: 0, inflight: false, flushTimer: null }
    entry.pending += 1
    map.set(key, entry)
    scheduleAddFlush(key, p)
  }

  // NEW: spam-safe +
  const inc = async (line: CartLine) => {
    if (!cartId) return
    optimisticInc(line)
    const key = lineKeyOf(line)
    const map = lineQueueRef.current
    const entry = map.get(key) ?? { delta: 0, inflight: false, flushTimer: null }
    entry.delta += 1
    map.set(key, entry)
    scheduleLineFlush(key, { productId: line.productId, variationId: line.variationId })
  }

  // NEW: spam-safe −
  const dec = async (line: CartLine) => {
    if (!cartId) return
    optimisticDec(line)
    const key = lineKeyOf(line)
    const map = lineQueueRef.current
    const entry = map.get(key) ?? { delta: 0, inflight: false, flushTimer: null }
    entry.delta -= 1
    map.set(key, entry)
    scheduleLineFlush(key, { productId: line.productId, variationId: line.variationId })
  }

  // Remove keeps the original guarded flow (disable while removing)
  const withLinePending = async (line: CartLine, fn: () => Promise<void>) => {
    const key = lineKeyOf(line)
    if (pendingLineKeys.has(key)) return
    setPendingKey(key, true)
    try {
      await fn()
    } finally {
      setPendingKey(key, false)
    }
  }

  const removeLine = async (line: CartLine) => {
    if (!cartId) return
    optimisticRemove(line)
    await withLinePending(line, async () => {
      try {
        const res = await fetch(`/api/pos/cart/${cartId}/remove-product`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: line.productId,
            variationId: line.variationId,
          }),
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) { setError(j?.error || "Failed to remove item"); await refreshCart(cartId); return }
        if (Array.isArray(j.lines)) setLines(mapServerLines(j.lines))
      } catch (e: any) {
        setError(e?.message || "Failed to remove item")
        await refreshCart(cartId)
      }
    })
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
              pendingKeys={pendingLineKeys}   // spinner only, not blocking +/-
            />
          </div>
        </div>

        {/* Mobile bottom bar → opens cart drawer */}
        <div className="lg:hidden sticky bottom-0 inset-x-0 border-t bg-card p-3">
          <Sheet open={cartSheetOpen} onOpenChange={setCartSheetOpen}>
            <button
              className="flex w-full items-center justify-between rounded-md bg-primary px-4 py-3 text-primary-foreground"
              onClick={() => setCartSheetOpen(true)}
            >
              <span className="flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                Cart • {itemCount}
              </span>
              <span>${totalEstimate.toFixed(2)}</span>
            </button>
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
                  pendingKeys={pendingLineKeys}   // spinner only, not blocking +/-
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
