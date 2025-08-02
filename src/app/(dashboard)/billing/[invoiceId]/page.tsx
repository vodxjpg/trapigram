"use client"

import { useState, useEffect } from "react"
import { useRouter, usePathname } from "next/navigation"
import { useHeaderTitle } from "@/context/HeaderTitleContext"
import { authClient } from "@/lib/auth-client"
import { useHasPermission } from "@/hooks/use-has-permission"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"

interface Item {
  itemId: string
  orderId: string
  feeAmount: string
  percentApplied: string
  amount: string
}
interface InvoiceDetail {
  id: string
  periodStart: string
  periodEnd: string
  totalAmount: string
  status: string
  dueDate: string
  createdAt: string
}

export default function InvoiceDetailPage() {
  const router = useRouter()
  const path = usePathname()
  const invoiceId = path.split("/").pop()!

  const { setHeaderTitle } = useHeaderTitle()

  // 1) permission guard
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? null
  const { hasPermission: canView, isLoading: permLoading } =
    useHasPermission(orgId, { payment: ["view"] })

  const [inv, setInv] = useState<InvoiceDetail | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setHeaderTitle("Invoice Details")
  }, [setHeaderTitle])

  useEffect(() => {
    if (!permLoading && !canView) router.replace("/billing")
  }, [permLoading, canView, router])

  useEffect(() => {
    if (canView) fetchDetail()
  }, [canView, invoiceId])

  async function fetchDetail() {
    setLoading(true)
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      credentials: "include",
    })
    if (!res.ok) {
      router.replace("/billing")
      return
    }
    const { invoice, items } = await res.json()
    setInv(invoice)
    setItems(items)
    setLoading(false)
  }

  if (permLoading || loading || !inv) {
    return <p className="p-6">Loading…</p>
  }

  const total = parseFloat(inv.totalAmount)
  const paid = inv.status === "paid" ? total : inv.status === "underpaid" ? total * 0.5 : 0
  const pending = total - paid
  const progress = total > 0 ? (paid / total) * 100 : 0

  return (
    <div className="p-6 space-y-6">
      <Button variant="link" onClick={() => router.back()}>
        ← Back
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Invoice {inv.id}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-6">
          <div className="space-y-1">
            <p>
              <strong>Period:</strong> {inv.periodStart} → {inv.periodEnd}
            </p>
            <p>
              <strong>Created:</strong>{" "}
              {new Date(inv.createdAt).toLocaleDateString()}
            </p>
            <p>
              <strong>Due:</strong> {inv.dueDate}
            </p>
          </div>
          <div className="space-y-1">
            <p>
              <strong>Total:</strong> ${total.toFixed(2)}
            </p>
            <p>
              <strong>Status:</strong>{" "}
              <Badge
                variant={
                  inv.status === "paid"
                    ? "success"
                    : inv.status === "underpaid"
                    ? "destructive"
                    : "outline"
                }
              >
                {inv.status}
              </Badge>
            </p>
            <div className="pt-2">
              <Progress value={progress} className="h-2" />
              <p className="text-sm">
                Paid: ${paid.toFixed(2)} / ${pending.toFixed(2)} pending
              </p>
            </div>
          </div>
          <div className="col-span-2 text-center">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code?size=150x150&data=${encodeURIComponent(
                inv.id
              )}`}
              alt="QR Code"
              className="mx-auto"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Line Items</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Order ID</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Rate</TableHead>
                <TableHead>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((it) => (
                <TableRow key={it.itemId}>
                  <TableCell>{it.orderId}</TableCell>
                  <TableCell>
                    ${parseFloat(it.feeAmount).toFixed(2)}
                  </TableCell>
                  <TableCell>{it.percentApplied}%</TableCell>
                  <TableCell>
                    ${parseFloat(it.amount).toFixed(2)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
