"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Minus, Plus, Trash2, Loader2 } from "lucide-react"

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

type CartProps = {
  lines: CartLine[]
  onInc: (line: CartLine) => void
  onDec: (line: CartLine) => void
  onRemove: (line: CartLine) => void
  onCheckout: () => void
  // discount controls
  discountType: "fixed" | "percentage"
  discountValue: string
  onDiscountType: (t: "fixed" | "percentage") => void
  onDiscountValue: (v: string) => void
  // display numbers (computed in parent)
  subtotal: number
  discountAmount: number
  total: number
  // layout variant
  variant?: "inline" | "sheet"
  // which cart lines have queued/inflight server updates (spinner only)
  pendingKeys?: Set<string>
}

function InitialsSquare({ text }: { text: string }) {
  const trimmed = (text || "").trim()
  const parts = trimmed.split(/\s+/)
  const firstTwo =
    (parts[0]?.[0] || "") + (parts.length > 1 ? parts[1]?.[0] || "" : parts[0]?.[1] || "")
  const initials = firstTwo.toUpperCase()
  return (
    <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-muted">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-10 w-10 rounded-full bg-muted-foreground/10 flex items-center justify-center">
          <span className="text-sm font-semibold text-muted-foreground">{initials || "P"}</span>
        </div>
      </div>
    </div>
  )
}

export function Cart({
  lines,
  onInc,
  onDec,
  onRemove,
  onCheckout,
  discountType,
  discountValue,
  onDiscountType,
  onDiscountValue,
  subtotal,
  discountAmount,
  total,
  variant = "inline",
  pendingKeys,
}: CartProps) {
  const wrapper =
    variant === "inline"
      ? "flex w-full flex-col border-l bg-card lg:w-96"
      : "flex h-full w-full flex-col bg-card rounded-t-2xl"

  const keyOf = (l: CartLine) => `${l.productId}:${l.variationId ?? "base"}`
  const isPending = (l: CartLine) => pendingKeys?.has(keyOf(l)) ?? false

  return (
    <div className={wrapper}>
      {/* Header */}
      <div className="border-b p-4">
        <h2 className="text-lg font-semibold text-foreground">Current Order</h2>
      </div>

      {/* Lines */}
      <ScrollArea className="flex-1 p-4">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">No items in cart</p>
          </div>
        ) : (
          <div className="space-y-3">
            {lines.map((l) => {
              const pending = isPending(l)
              return (
                <Card key={keyOf(l)} className="p-3 relative">
                  {/* NOTE: No blocking overlay; show only a tiny spinner while pending */}
                  <div className="flex gap-3">
                    {l.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.image} alt={l.title} className="h-16 w-16 rounded-md object-cover" />
                    ) : (
                      <InitialsSquare text={l.title} />
                    )}
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-medium text-sm text-foreground line-clamp-2">{l.title}</h3>
                          <p className="text-xs text-muted-foreground">Unit: ${Number(l.unitPrice).toFixed(2)}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => onRemove(l)}
                          disabled={pending}  // keep remove guarded while syncing
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>

                      <div className="mt-2 flex items-center justify-between">
                        <div className="relative flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 bg-transparent"
                            onClick={() => onDec(l)}   // never disabled; parent coalesces
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-8 text-center text-sm font-medium">{l.quantity}</span>
                          <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7 bg-transparent"
                            onClick={() => onInc(l)}   // never disabled; parent coalesces
                          >
                            <Plus className="h-3 w-3" />
                          </Button>

                          {/* Tiny inline spinner when queued/inflight */}
                          {pending && (
                            <span className="ml-2 inline-flex items-center">
                              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                            </span>
                          )}
                        </div>

                        <p className="font-semibold text-sm">${(l.subtotal).toFixed(2)}</p>
                      </div>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}
      </ScrollArea>

      {/* Totals */}
      <div className="border-t p-4 space-y-3">
        {/* Discount control */}
        <div className="space-y-2">
          <span className="text-sm font-medium text-foreground">Discount</span>
          <div className="flex items-center gap-2">
            <select
              className="h-9 rounded-md border bg-background px-2 text-sm"
              value={discountType}
              onChange={(e) => onDiscountType(e.target.value as "fixed" | "percentage")}
            >
              <option value="fixed">$ Fixed</option>
              <option value="percentage">% Percentage</option>
            </select>
            <input
              type="text"
              inputMode="decimal"
              pattern="^\\d*([.]\\d{0,2})?$"
              className="h-9 w-24 rounded-md border bg-background px-2 text-sm"
              placeholder="0"
              value={discountValue}
              onChange={(e) => onDiscountValue(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Subtotal</span>
            <span className="font-medium">${subtotal.toFixed(2)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Discount</span>
              <span className="font-medium">- ${discountAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tax</span>
            <span className="font-medium">Calculated at checkout</span>
          </div>
          <Separator />
          <div className="flex justify-between text-lg font-bold">
            <span>Total</span>
            <span className="text-primary">${total.toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Checkout */}
      <div className="border-t p-4">
        <Button className="w-full" size="lg" disabled={lines.length === 0} onClick={onCheckout}>
          Checkout ${total.toFixed(2)}
        </Button>
      </div>
    </div>
  )
}
