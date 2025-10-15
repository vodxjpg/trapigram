"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Minus, Plus, Trash2 } from "lucide-react"
import Image from "next/image"

export type CartLine = {
  productId: string
  variationId: string | null
  title: string
  image: string | null
  sku: string | null
  quantity: number
  unitPrice: number
  subtotal: number
  isAffiliate?: boolean
}

type CartProps = {
  lines: CartLine[]
  taxInclusive: boolean
  onInc: (line: CartLine) => void
  onDec: (line: CartLine) => void
  onRemove: (line: CartLine) => void
  onCheckout: () => void
}

export function Cart({
  lines,
  taxInclusive,
  onInc,
  onDec,
  onRemove,
  onCheckout,
}: CartProps) {
  const subtotal = lines.reduce((s, l) => s + l.subtotal, 0)

  return (
    <div className="flex w-full flex-col border-l bg-card lg:w-96">
      {/* Cart Header */}
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold text-foreground">Current Order</h2>
        <p className="text-xs text-muted-foreground">
          Prices {taxInclusive ? "include" : "exclude"} tax (exact tax at checkout)
        </p>
      </div>

      {/* Cart Items */}
      <ScrollArea className="flex-1 p-4">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No items in cart</p>
          </div>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => (
              <Card key={`${l.productId}:${l.variationId ?? "base"}`} className="p-3">
                <div className="flex gap-3">
                  <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                    <Image src={l.image || "/placeholder.svg"} alt={l.title} fill className="object-cover" />
                  </div>
                  <div className="flex flex-1 flex-col">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3 className="font-medium text-sm text-foreground line-clamp-2">{l.title}</h3>
                        <p className="text-xs text-muted-foreground">
                          Unit: ${Number(l.unitPrice).toFixed(2)}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onRemove(l)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 bg-transparent"
                          onClick={() => onDec(l)}
                        >
                          <Minus className="h-3 w-3" />
                        </Button>
                        <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-7 w-7 bg-transparent"
                          onClick={() => onInc(l)}
                        >
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="font-semibold text-sm">${(l.subtotal).toFixed(2)}</p>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>

      {/* Totals */}
      <div className="border-t p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">${subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-medium">Calculated at checkout</span>
          </div>
          <Separator />
          <div className="flex justify-between text-lg font-bold">
            <span>Estimate</span>
            <span className="text-primary">${subtotal.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Checkout Button */}
      <div className="border-t p-4">
        <Button className="w-full" size="lg" disabled={lines.length === 0} onClick={onCheckout}>
          Checkout
        </Button>
      </div>
    </div>
  )
}
