"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ProductGrid, type GridProduct } from "./product-grid"
import { Cart, type CartLine } from "./cart"
import { CategoryNav } from "./category-nav"
import { CustomerSelector, type Customer } from "./customer-selector"
import { CheckoutDialog } from "./checkout-dialog"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { StoreRegisterSelector } from "./store-register-selector"

type Category = { id: string; name: string }

const LS_KEYS = {
  STORE: "pos.storeId",
  REGISTER: "pos.registerId",
  CART: (registerId: string) => `pos.cartId.${registerId}`,
  TAX_INCL: "pos.taxInclusive",
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

export function POSInterface() {
  // register / store
  const [storeId, setStoreId] = useState<string | null>(null)
  const [registerId, setRegisterId] = useState<string | null>(null)

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
  const [taxInclusive, setTaxInclusive] = useState<boolean>(() => {
    if (typeof window === "undefined") return true
    const v = localStorage.getItem(LS_KEYS.TAX_INCL)
    return v === null ? true : v === "1"
  })
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const creatingCartRef = useRef(false)

  // restore persisted choices
  useEffect(() => {
    if (typeof window === "undefined") return
    const s = localStorage.getItem(LS_KEYS.STORE)
    const r = localStorage.getItem(LS_KEYS.REGISTER)
    if (s) setStoreId(s)
    if (r) setRegisterId(r)
    const clientId = localStorage.getItem(LS_KEYS.CLIENT)
    if (clientId) {
      // best-effort load for name/email
      fetch(`/api/clients/${clientId}`).then(res => res.ok ? res.json() : null).then((data) => {
        if (data?.client) {
          const c = data.client
          setSelectedCustomer({ id: c.id, name: c.firstName ?? "Customer", email: c.email ?? null, phone: c.phoneNumber ?? null })
        }
      }).catch(() => {})
    }
  }, [])

  // persist taxInclusive toggle
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.TAX_INCL, taxInclusive ? "1" : "0")
    }
  }, [taxInclusive])

  // store/register changes -> load cart (or clear)
  useEffect(() => {
    if (!registerId) {
      setCartId(null)
      setLines([])
      return
    }
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.REGISTER, registerId)
      const savedCartId = localStorage.getItem(LS_KEYS.CART(registerId))
      if (savedCartId) {
        setCartId(savedCartId)
        refreshCart(savedCartId)
      } else {
        setCartId(null)
        setLines([])
      }
    }
  }, [registerId])

  // fetch categories
  useEffect(() => {
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch("/api/product-categories?all=1").then(r => r.json())
        if (ignore) return
        const cats: Category[] = (res.categories || []).map((c: any) => ({ id: c.id, name: c.name }))
        setCategories(cats)
      } catch (e) {
        console.error(e)
      }
    })()
    return () => { ignore = true }
  }, [])

  // fetch products page (flat variations) - basic paging disabled here for simplicity
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
      } catch (e) {
        console.error("load products", e)
      }
    })()
    return () => { ignore = true }
  }, [debouncedSearch])

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
      if (registerId && typeof window !== "undefined") {
        localStorage.setItem(LS_KEYS.CART(registerId), newCartId)
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
          productId: l.id,              // in GET mapper: id is product/affiliate id
          variationId: l.variationId ?? null,
          title: l.title,
          image: l.image ?? null,
          sku: l.sku ?? null,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          subtotal: Number(l.subtotal),
          isAffiliate: Boolean(l.isAffiliate),
        }))
      )
    } catch (e) {
      console.error(e)
    }
  }

  const addToCart = async (p: GridProduct) => {
    try {
      if (!selectedCustomer?.id) {
        alert("Pick or create a customer first (tip: Walk-in).")
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
        alert(e?.error || "Failed to add to cart")
        return
      }
      await refreshCart(cid)
    } catch (e) {
      console.error(e)
      alert("Failed to add to cart.")
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
      alert(e?.error || "Failed to update quantity")
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
      alert(e?.error || "Failed to update quantity")
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
      alert(e?.error || "Failed to remove item")
      return
    }
    await refreshCart(cartId)
  }

  const onCompleteCheckout = (orderId: string) => {
    // open receipt
    try {
      window.open(`/api/pos/receipts/${orderId}/pdf`, "_blank")
    } catch {}
    // clear cart context for this register
    if (registerId && typeof window !== "undefined") {
      localStorage.removeItem(LS_KEYS.CART(registerId))
    }
    setCartId(null)
    setLines([])
  }

  const setStoreRegister = ({ storeId: s, registerId: r }: { storeId: string; registerId: string }) => {
    setStoreId(s)
    setRegisterId(r)
    if (typeof window !== "undefined") {
      localStorage.setItem(LS_KEYS.STORE, s)
      localStorage.setItem(LS_KEYS.REGISTER, r)
    }
  }

  return (
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

          <div className="ml-2 flex items-center gap-2 rounded-md border px-3 py-1.5">
            <Switch id="tax-incl" checked={taxInclusive} onCheckedChange={setTaxInclusive} />
            <Label htmlFor="tax-incl" className="text-sm">Tax inclusive</Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <StoreRegisterSelector
            storeId={storeId}
            registerId={registerId}
            onChange={setStoreRegister}
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
          taxInclusive={taxInclusive}
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
        registerId={registerId}
        taxInclusive={taxInclusive}
        onComplete={onCompleteCheckout}
      />
    </div>
  )
}
