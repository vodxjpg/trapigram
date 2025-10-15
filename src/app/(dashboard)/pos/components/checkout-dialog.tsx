"use client"

import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { CreditCard, Banknote, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

type PaymentMethod = "card" | "cash"

type Payment = {
  method: PaymentMethod
  amount: number
}

type CheckoutDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalEstimate: number
  cartId: string | null
  clientId: string | null
  registerId: string | null
  onComplete: (orderId: string) => void
}

export function CheckoutDialog({
  open,
  onOpenChange,
  totalEstimate,
  cartId,
  clientId,
  registerId,
  onComplete,
}: CheckoutDialogProps) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [currentMethod, setCurrentMethod] = useState<PaymentMethod>("card")
  const [currentAmount, setCurrentAmount] = useState("")
  const [cashReceived, setCashReceived] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const totalPaid = useMemo(() => payments.reduce((sum, p) => sum + p.amount, 0), [payments])
  const remaining = Math.max(0, totalEstimate - totalPaid)
  const change = currentMethod === "cash" && cashReceived ? Math.max(0, Number.parseFloat(cashReceived) - (Number.parseFloat(currentAmount || "0"))) : 0

  useEffect(() => {
    if (!open) {
      setPayments([])
      setCurrentAmount("")
      setCashReceived("")
      setBusy(false)
      setError(null)
    }
  }, [open])

  const handleAddPayment = () => {
    const amount = Number.parseFloat(currentAmount)
    if (Number.isFinite(amount) && amount > 0 && amount <= remaining) {
      setPayments(prev => [...prev, { method: currentMethod, amount }])
      setCurrentAmount("")
      setCashReceived("")
    }
  }

  const handleQuickAmount = (fraction: number) => {
    const v = Math.max(0, remaining * fraction)
    setCurrentAmount(v.toFixed(2))
    if (currentMethod === "cash") setCashReceived(v.toFixed(2))
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
      const payload = {
        cartId,
        clientId,
        registerId,
        payments: payments.map(p => ({
          methodId: p.method,  // "cash" | "card"
          amount: p.amount,
        })),
      }
      const res = await fetch("/api/pos/checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idem,
        },
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
            {/* Payment Summary */}
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

            {/* Existing Payments */}
            {payments.length > 0 && (
              <div className="space-y-2">
                <div className="space-y-2">
                  {payments.map((p, idx) => (
                    <Card key={idx} className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {p.method === "card" ? <CreditCard className="h-4 w-4" /> : <Banknote className="h-4 w-4" />}
                          <span className="capitalize">{p.method}</span>
                        </div>
                        <span className="font-medium">${p.amount.toFixed(2)}</span>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {remaining > 0 && (
              <>
                {/* Method */}
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <Card
                      className={cn("p-4 cursor-pointer transition-all hover:border-primary", currentMethod === "card" && "border-primary bg-primary/5")}
                      onClick={() => setCurrentMethod("card")}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <CreditCard className="h-6 w-6" />
                        <span className="font-medium">Card</span>
                      </div>
                    </Card>
                    <Card
                      className={cn("p-4 cursor-pointer transition-all hover:border-primary", currentMethod === "cash" && "border-primary bg-primary/5")}
                      onClick={() => setCurrentMethod("cash")}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <Banknote className="h-6 w-6" />
                        <span className="font-medium">Cash</span>
                      </div>
                    </Card>
                  </div>
                </div>

                {/* Amount */}
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

                {/* Cash Specific */}
                {currentMethod === "cash" && (
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

                <Button
                  className="w-full"
                  onClick={handleAddPayment}
                  disabled={!currentAmount || Number.parseFloat(currentAmount) <= 0}
                >
                  Add Payment
                </Button>
              </>
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
