"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import Image from "next/image"

export type GridProduct = {
  id: string           // parent productId
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
}

export function ProductGrid({ products, onAddToCart }: ProductGridProps) {
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {products.map((product) => (
          <Card
            key={`${product.productId}:${product.variationId ?? "base"}`}
            className="group cursor-pointer overflow-hidden transition-all hover:shadow-lg"
            onClick={() => onAddToCart(product)}
          >
            <div className="relative aspect-square bg-muted">
              <Image
                src={product.image || "/placeholder.svg"}
                alt={product.title}
                fill
                className="object-cover"
              />
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
            </div>
            <div className="p-3">
              <h3 className="font-medium text-foreground line-clamp-2">{product.title}</h3>
              <p className="mt-1 text-lg font-bold text-primary">
                ${product.priceForDisplay.toFixed(2)}
              </p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
