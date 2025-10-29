"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus, Loader2 } from "lucide-react"
import Image from "next/image"

export type GridProduct = {
  id: string
  productId: string
  variationId: string | null
  title: string
  image: string | null
  categoryIds: string[]
  priceForDisplay: number
}

type ProductGridProps = {
  products: GridProduct[]
  onAddToCart: (p: GridProduct) => void
  /** Tiles briefly show this spinner after optimistic add (non-blocking) */
  addingKeys?: Set<string>
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

export function ProductGrid({ products, onAddToCart, addingKeys }: ProductGridProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product) => {
          const key = `${product.productId}:${product.variationId ?? "base"}`
          const isLoading = addingKeys?.has(key) ?? false

          return (
            <Card
              key={key}
              className="group relative cursor-pointer overflow-hidden transition-all hover:shadow-lg"
              onClick={() => {
                // Always allow clicks — queue coalesces network work
                onAddToCart(product)
              }}
              aria-busy={isLoading}
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

                {/* Hover CTA (still works while spinner pings) */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition-all group-hover:bg-black/10">
                  <Button
                    size="icon"
                    className="scale-0 transition-transform group-hover:scale-100"
                    onClick={(e) => {
                      e.stopPropagation()
                      onAddToCart(product)
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>

                {/* Quick spinner overlay — non-blocking (pointer-events: none) */}
                {isLoading && (
                  <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30">
                    <Loader2 className="h-6 w-6 animate-spin text-white" />
                  </div>
                )}
              </div>

              <div className="p-3">
                <h3 className="font-medium text-foreground line-clamp-2">{product.title}</h3>
                <p className="mt-1 text-lg font-bold text-primary">
                  ${product.priceForDisplay.toFixed(2)}
                </p>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
