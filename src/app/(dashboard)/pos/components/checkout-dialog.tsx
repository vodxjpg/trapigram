// src/app/(dashboard)/pos/components/checkout-dialog.tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  AlertDialog, AlertDialogAction, AlertDialogContent,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from "@/components/ui/alert-dialog"

type PaymentMethodRow = {
  id: string
  name: string
  description?: string | null
  instructions?: string | null
}

type Payment = { methodId: string; amount: number }

type CheckoutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalEstimate: number
  cartId: string | null
  clientId: string | null
  registerId: string | null
  storeId: string | null
  onComplete: (orderId: string) => void
}

export function CheckoutDialog(props: CheckoutDialogProps) {
  const { open, onOpenChange, totalEstimate, cartId, clientId, registerId, storeId, onComplete } = props

  const [paymentMethods, setPaymentMethods] = useState<PaymentMethodRow[]>([])
  const [currentMethodId, setCurrentMethodId] = useState<string | null>(null)

  const [payments, setPayments] = useState<Payment[]>([])
  const [currentAmount, setCurrentAmount] = useState("")
  const [cashReceived, setCashReceived] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPaid = useMemo(() => payments.reduce((s, p) => s + p.amount, 0), [payments])
  const remaining = Math.max(0, totalEstimate - totalPaid)

  // Heuristic: show cash-received UI if selected method name contains "cash"
  const currentIsCash = useMemo(() => {
    const m = paymentMethods.find(pm => pm.id === currentMethodId)
    return (m?.name || "").toLowerCase().includes("cash")
  }, [paymentMethods, currentMethodId])

  const change = currentIsCash && cashReceived
    ? Math.max(0, Number.parseFloat(cashReceived) - (Number.parseFloat(currentAmount || "0")))
    : 0

  // Reset on close
  useEffect(() => {
    if (!open) {
      setPayments([])
      setCurrentAmount("")
      setCashReceived("")
      setBusy(false)
      setError(null)
      // keep payment methods cached
    }
  }, [open])

  // Load active payment methods from server when dialog opens
  useEffect(() => {
    if (!open || !cartId) return
    let ignore = false
    ;(async () => {
      try {
        const res = await fetch(`/api/pos/checkout?cartId=${encodeURIComponent(cartId)}`)
        if (!res.ok) {
          const e = await res.json().catch(() => ({}))
          throw new Error(e?.error || "Failed to load payment methods")
        }
        const j = await res.json()
        const methods: PaymentMethodRow[] = j.paymentMethods || []
        if (!ignore) {
          setPaymentMethods(methods)
          if (!currentMethodId && methods[0]) setCurrentMethodId(methods[0].id)
        }
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to load payment methods")
      }
    })()
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, cartId])

  const handleAddPayment = () => {
    const amount = Number.parseFloat(currentAmount)
    if (!currentMethodId) return
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) return

    // Merge duplicate methods: if the same method already exists, add to it
    setPayments(prev => {
      const idx = prev.findIndex(p => p.methodId === currentMethodId)
      if (idx >= 0) {
        const next = [...prev]
        const updated = {
          ...next[idx],
          amount: Number((next[idx].amount + amount).toFixed(2)),
        }
        next[idx] = updated
        return next
      }
      return [...prev, { methodId: currentMethodId, amount }]
    })
    setCurrentAmount("")
    setCashReceived("")
  }

  const handleQuickAmount = (fraction: number) => {
    const v = Math.max(0, remaining * fraction)
    setCurrentAmount(v.toFixed(2))
    if (currentIsCash) setCashReceived(v.toFixed(2))
  }

  const submitCheckout = async () => {
    if (!cartId || !clientId || !registerId) {
      setError("Missing cart, customer or outlet.")
      return
    }
    if (remaining > 0) return

    try {
      setBusy(true)
      const idem = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
      const payload = { cartId, payments, storeId, registerId }
      const res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idem },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e?.error || "Checkout failed")
      }
      const data = await res.json()
      const orderId = data?.order?.id || data?.orderId
      if (!orderId) throw new Error("No order id returned")
      onComplete(orderId)
      onOpenChange(false)
    } catch (e: any) {
      setError(e?.message || "Checkout failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Checkout</DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Totals */}
            <div className="space-y-2">
              <div className="flex justify-between text-lg">
                <span className="font-medium">Estimated Total</span>
                <span className="font-bold text-primary">${totalEstimate.toFixed(2)}</span>
              </div>
              {payments.length > 0 && (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Paid</span>
                    <span className="text-accent">${totalPaid.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-lg">
                    <span className="font-medium">Remaining</span>
                    <span className="font-bold">${remaining.toFixed(2)}</span>
                  </div>
                </>
              )}
            </div>

            {/* Active payment methods */}
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <div className="grid grid-cols-2 gap-3">
                {paymentMethods.map((m) => (
                  <Card
                    key={m.id}
                    className={cn(
                      "p-4 cursor-pointer transition-all hover:border-primary",
                      currentMethodId === m.id && "border-primary bg-primary/5"
                    )}
                    onClick={() => setCurrentMethodId(m.id)}
                  >
                    <div className="flex flex-col items-center gap-1">
                      <span className="font-medium">{m.name}</span>
                      {m.description && <span className="text-xs text-muted-foreground">{m.description}</span>}
                    </div>
                  </Card>
                ))}
              </div>
            </div>

            {/* Amount */}
            {remaining > 0 && (
              <>
                <div className="space-y-2">
                  <Label>Amount</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    max={remaining}
                    value={currentAmount}
                    onChange={(e) => setCurrentAmount(e.target.value)}
                    placeholder="0.00"
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.25)}>25%</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.5)}>50%</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(0.75)}>75%</Button>
                    <Button variant="outline" size="sm" onClick={() => handleQuickAmount(1)}>Full</Button>
                  </div>
                </div>

                {/* Cash-only helper */}
                {currentIsCash && (
                  <div className="space-y-2">
                    <Label>Cash Received</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={cashReceived}
                      onChange={(e) => setCashReceived(e.target.value)}
                      placeholder={currentAmount || "0.00"}
                    />
                    {change > 0 && (
                      <p className="text-sm">
                        Change: <span className="font-bold text-accent">${change.toFixed(2)}</span>
                      </p>
                    )}
                  </div>
                )}

                <Button className="w-full" onClick={handleAddPayment} disabled={!currentAmount || !currentMethodId || Number.parseFloat(currentAmount) <= 0}>
                  Add Payment
                </Button>
              </>
            )}

            {/* List payments */}
            {payments.length > 0 && (
              <div className="space-y-2">
                {payments.map((p) => {
                  const methodName = paymentMethods.find(pm => pm.id === p.methodId)?.name ?? p.methodId
                  return (
                    <Card key={p.methodId} className="p-3">
                      <div className="flex items-center justify-between">
                        <span>{methodName}</span>
                        <span className="font-medium">${p.amount.toFixed(2)}</span>
                      </div>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              {payments.length > 0 && (
                <Button variant="outline" onClick={() => { setPayments([]); setCurrentAmount(""); setCashReceived("") }}>
                  Reset
                </Button>
              )}
              <Button className="flex-1 gap-2" onClick={submitCheckout} disabled={remaining > 0 || busy}>
                <Check className="h-4 w-4" />
                Complete Transaction
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Error dialog */}
      <AlertDialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Checkout error</AlertDialogTitle>
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
