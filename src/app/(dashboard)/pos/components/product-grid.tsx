"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, CheckCircle2, AlertTriangle, Ban } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"

export type GridProduct = {
  id: string
  productId: string
  variationId: string | null
  title: string
  image: string | null
  categoryIds: string[]
  priceForDisplay: number
  /** Inventory */
  stockQty: number | null          // null = unlimited / unmanaged
  allowBackorder: boolean
  manageStock: boolean
}

type ProductGridProps = {
  products: GridProduct[]
  onAddToCart: (p: GridProduct) => void
  /** Tiles briefly show this spinner after optimistic add (non-blocking) */
  addingKeys?: Set<string>
  /** Current shown quantities per key (already includes optimistic overlay) */
  shownQtyByKey: Map<string, number>
}

function InitialsCircle({ text }: { text: string }) {
  const trimmed = (text || "").trim()
  const parts = trimmed.split(/\s+/)
  const firstTwo =
    (parts[0]?.[0] || "") + (parts.length > 1 ? parts[1]?.[0] || "" : parts[0]?.[1] || "")
  const initials = firstTwo.toUpperCase()
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="h-16 w-16 rounded-full bg-muted-foreground/10 flex items-center justify-center">
        <span className="text-lg font-semibold text-muted-foreground">{initials || "P"}</span>
      </div>
    </div>
  )
}

const keyOf = (p: GridProduct) => `${p.productId}:${p.variationId ?? "base"}`
const remainingFor = (p: GridProduct, shown: number) => {
  if (p.stockQty == null) return Infinity
  return Math.max(0, p.stockQty - shown)
}

export function ProductGrid({ products, onAddToCart, addingKeys, shownQtyByKey }: ProductGridProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product) => {
          const key = keyOf(product)
          const isLoading = addingKeys?.has(key) ?? false
          const shown = shownQtyByKey.get(key) ?? 0
          const remain = remainingFor(product, shown)
          const oos = remain === 0 && product.stockQty !== null
          const canBackorder = product.allowBackorder && product.stockQty !== null && remain === 0

          return (
            <Card
              key={key}
              className={cn(
                "group relative overflow-hidden transition-all",
                oos && !product.allowBackorder ? "opacity-60" : "cursor-pointer hover:shadow-lg"
              )}
              onClick={() => {
                if (oos && !product.allowBackorder) return
                onAddToCart(product)
              }}
              aria-busy={isLoading}
              aria-disabled={oos && !product.allowBackorder}
            >
              <div className="relative aspect-square bg-muted">
                {product.image ? (
                  <Image
                    src={product.image}
                    alt={product.title}
                    fill
                    sizes="200px"
                    className="object-cover"
                  />
                ) : (
                  <InitialsCircle text={product.title} />
                )}

                {/* Hover CTA */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/10">
                  <Button
                    size="icon"
                    className={cn(
                      "scale-0 transition-transform group-hover:scale-100",
                      oos && !product.allowBackorder && "pointer-events-none opacity-0"
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (oos && !product.allowBackorder) return
                      onAddToCart(product)
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Quick spinner overlay — non-blocking */}
                {isLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>

              <div className="p-3 space-y-1.5">
                <h3 className="font-medium text-foreground line-clamp-2">{product.title}</h3>
                <p className="text-lg font-bold text-primary">
                  ${product.priceForDisplay.toFixed(2)}
                </p>

                {/* Stock + backorder badge (optimistic) */}
                <div className="mt-1 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    {product.stockQty == null ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>In stock</span>
                      </>
                    ) : oos ? (
                      product.allowBackorder ? (
                        <>
                          <AlertTriangle className="h-3.5 w-3.5" />
                          <span>Back-order</span>
                        </>
                      ) : (
                        <>
                          <Ban className="h-3.5 w-3.5" />
                          <span>Out of stock</span>
                        </>
                      )
                    ) : (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{remain} left</span>
                      </>
                    )}
                  </div>

                  {product.manageStock && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5",
                        product.stockQty == null
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                          : remain === 0
                          ? (canBackorder
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
                              : "bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-300")
                          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300"
                      )}
                      title={
                        product.stockQty == null
                          ? "Stock unmanaged (∞)"
                          : canBackorder
                          ? "No stock, back-orders allowed"
                          : `${remain} available`
                      }
                    >
                      {product.stockQty == null ? "∞" : remain}
                    </span>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
