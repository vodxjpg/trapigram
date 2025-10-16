"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  orderId: string | null
  defaultEmail?: string | null
}

export function ReceiptOptionsDialog({ open, onOpenChange, orderId, defaultEmail }: Props) {
  const [email, setEmail] = useState(defaultEmail ?? "")
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

  const pdfUrl = orderId ? `/api/pos/receipts/${orderId}/pdf` : "#"

  const doPrint = () => {
    if (!orderId) return
    try { window.open(pdfUrl, "_blank") } catch {}
  }

  const sendEmail = async () => {
    if (!orderId) return
    try {
      setSending(true)
      setError(null)
      setOkMsg(null)
      const res = await fetch(`/api/pos/receipts/${orderId}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: email }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e?.error || "Failed to email receipt")
      }
      setOkMsg("Receipt sent.")
    } catch (e: any) {
      setError(e?.message || "Failed to email receipt")
    } finally {
      setSending(false)
    }
  }

  const doBoth = async () => {
    doPrint()
    await sendEmail()
  }

  const close = () => {
    setError(null)
    setOkMsg(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Receipt options</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="receipt-email">Email (optional)</Label>
            <Input
              id="receipt-email"
              placeholder="customer@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              We’ll email a link to the receipt PDF. Leave blank to skip email.
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          {okMsg && <p className="text-sm text-green-600">{okMsg}</p>}

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={doPrint} disabled={!orderId}>
              Print
            </Button>
            <Button onClick={sendEmail} disabled={!orderId || !email || sending}>
              {sending ? "Sending..." : "Email"}
            </Button>
            <Button onClick={doBoth} disabled={!orderId || !email || sending}>
              {sending ? "Sending..." : "Both"}
            </Button>
            <Button variant="ghost" onClick={close}>
              Skip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
