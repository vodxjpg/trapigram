"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { useHeaderTitle } from "@/context/HeaderTitleContext"
import { authClient } from "@/lib/auth-client"
import { useHasPermission } from "@/hooks/use-has-permission"
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select"

interface Invoice {
  id: string
  periodStart: string
  periodEnd: string
  totalAmount: string
  status: string
  dueDate: string
  createdAt: string
}
interface InvoicesResponse {
  items: Invoice[]
  meta: { total: number; page: number; pages: number }
}

export default function BillingPage() {
  const router = useRouter()
  const { setHeaderTitle } = useHeaderTitle()

  // 1) permission guard
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? null
  const { hasPermission: canView, isLoading: permLoading } =
    useHasPermission(orgId, { payment: ["view"] })

  // 2) pagination state
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(10)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setHeaderTitle("Billing")
  }, [setHeaderTitle])

  // redirect if no permission
  useEffect(() => {
    if (!permLoading && !canView) router.replace("/")
  }, [permLoading, canView])

  // fetch whenever page/limit changes
  useEffect(() => {
    if (canView) fetchInvoices()
  }, [canView, page, limit])

  async function fetchInvoices() {
    setLoading(true)
    const res = await fetch(`/api/invoices?page=${page}&limit=${limit}`, {
      credentials: "include",
    })
    if (res.ok) {
      const data = (await res.json()) as InvoicesResponse
      setInvoices(data.items)
      setTotalPages(data.meta.pages)
    }
    setLoading(false)
  }

  if (permLoading || loading) {
    return <p className="p-6">Loading…</p>
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Billing</h1>
        <div className="flex items-center space-x-2">
          <span>Show</span>
          <Select
            value={limit.toString()}
            onValueChange={(v) => {
              setLimit(Number(v))
              setPage(1)
            }}
          >
            <SelectTrigger className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 20, 50, 100].map((n) => (
                <SelectItem key={n} value={n.toString()}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span>per page</span>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Due</TableHead>
            <TableHead>Created</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invoices.map((inv) => (
            <TableRow key={inv.id}>
              <TableCell>
                {inv.periodStart} → {inv.periodEnd}
              </TableCell>
              <TableCell>${parseFloat(inv.totalAmount).toFixed(2)}</TableCell>
              <TableCell>
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
              </TableCell>
              <TableCell>{inv.dueDate}</TableCell>
              <TableCell>
                {new Date(inv.createdAt).toLocaleDateString()}
              </TableCell>
              <TableCell>
                <Button
                  variant="link"
                  onClick={() => router.push(`/billing/${inv.id}`)}
                >
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex justify-center space-x-2">
        <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          disabled={page >= totalPages}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
