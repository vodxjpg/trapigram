"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ProductGrid, type GridProduct } from "./product-grid"
import { Cart } from "./cart"
import { CategoryNav } from "./category-nav"
import { CustomerSelector, type Customer } from "./customer-selector"
import { CheckoutDialog } from "./checkout-dialog"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { StoreRegisterSelector } from "./store-register-selector"
import { Button } from "@/components/ui/button"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type Category = { id: string; name: string }

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

  // restore persisted choices
  useEffect(() => {
    if (typeof window === "undefined") return
    const s = localStorage.getItem(LS_KEYS.STORE)
    const r = localStorage.getItem(LS_KEYS.OUTLET)
    if (s) setStoreId(s)
    if (r) setOutletId(r)
  }, [])

  // First-run: require store→outlet selection
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
        const cats: Category[] = (res.categories || []).map((c: any) => ({ id: c.id, name: c.name }))
        setCategories(cats)
      } catch {}
    })()
    return () => { ignore = true }
  }, [])

  // fetch products page (flat variations)
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
            id: p.id,
            productId: p.productId,
            variationId: p.variationId ?? null,
            title: p.title,
            image: p.image ?? null,
            categoryIds: p.categories ?? [],
            priceForDisplay: Number(price) || 0,
          } as GridProduct
        })
        setProducts(flat)
      } catch {}
    })()
    return () => { ignore = true }
  }, [debouncedSearch])

  // DEFAULT: ensure Walk-in selected/created
  useEffect(() => {
    let ignore = false
    const ensureWalkIn = async () => {
      if (selectedCustomer) return
      try {
        // Try to find an existing walk-in quickly
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
          // create a dedicated walk-in with stable username
          const r = await fetch("/api/clients", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: `walkin-${Date.now()}`, firstName: "Walk-in" }),
          })
          if (!r.ok) throw new Error("Failed to create walk-in client.")
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
  }, [])

  const filteredProducts = useMemo(() => {
    const q = debouncedSearch.toLowerCase()
    return products.filter(p => {
      const matchesCategory = selectedCategoryId === null || p.categoryIds.includes(selectedCategoryId)
      const matchesSearch = !q || p.title.toLowerCase().includes(q)
      return matchesCategory && matchesSearch
    })
  }, [products, selectedCategoryId, debouncedSearch])

  const subtotalEstimate = useMemo(() => lines.reduce((s, l) => s + l.subtotal, 0), [lines])

  const ensureCart = async (clientId: string) => {
    if (cartId || creatingCartRef.current) return cartId
    creatingCartRef.current = true
    try {
      const idem = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const res = await fetch("/api/pos/cart", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify({ clientId }),
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
      setLines(
        list.map((l) => ({
          productId: l.id,
          variationId: l.variationId ?? null,
          title: l.title,
          image: l.image ?? null,
          sku: l.sku ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.subtotal),
        }))
      )
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
      const cid = await ensureCart(selectedCustomer.id)
      if (!cid) return
      const idem = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const res = await fetch(`/api/pos/cart/${cid}/add-product`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify({
          productId: p.productId,
          variationId: p.variationId,
          quantity: 1,
        }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        setError(e?.error || "Failed to add to cart")
        return
      }
      await refreshCart(cid)
    } catch (e: any) {
      setError(e?.message || "Failed to add to cart.")
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
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setError(e?.error || "Failed to update quantity")
      return
    }
    await refreshCart(cartId)
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
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setError(e?.error || "Failed to update quantity")
      return
    }
    await refreshCart(cartId)
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
    if (!res.ok) {
      const e = await res.json().catch(() => ({}))
      setError(e?.error || "Failed to remove item")
      return
    }
    await refreshCart(cartId)
  }

  const onCompleteCheckout = (orderId: string) => {
    try {
      window.open(`/api/pos/receipts/${orderId}/pdf`, "_blank")
    } catch {}
    if (outletId && typeof window !== "undefined") {
      localStorage.removeItem(LS_KEYS.CART(outletId))
    }
    setCartId(null)
    setLines([])
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
            {/* Switch outlet/shop anytime */}
            <StoreRegisterSelector
              storeId={storeId}
              outletId={outletId}
              onChange={setStoreOutlet}
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
          {/* Products Section */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <CategoryNav
              categories={categories}
              selectedCategoryId={selectedCategoryId}
              onSelect={setSelectedCategoryId}
            />
            <ProductGrid products={filteredProducts} onAddToCart={addToCart} />
          </div>

          {/* Cart Section */}
          <Cart
            lines={lines}
            onInc={inc}
            onDec={dec}
            onRemove={removeLine}
            onCheckout={() => setCheckoutOpen(true)}
          />
        </div>

        {/* Checkout Dialog */}
        <CheckoutDialog
          open={checkoutOpen}
          onOpenChange={setCheckoutOpen}
          totalEstimate={subtotalEstimate}
          cartId={cartId}
          clientId={selectedCustomer?.id ?? null}
          registerId={outletId}
          onComplete={onCompleteCheckout}
        />
      </div>

      {/* First-run: force store/outlet selection */}
      <StoreRegisterSelector
        storeId={storeId}
        outletId={outletId}
        onChange={setStoreOutlet}
        forceOpen={forceSelectDialog}
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
