"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User, UserPlus, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"

export type Customer = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

type CustomerSelectorProps = {
  selectedCustomer: Customer | null
  onSelectCustomer: (customer: Customer | null) => void
}

export function CustomerSelector({ selectedCustomer, onSelectCustomer }: CustomerSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [newCustomer, setNewCustomer] = useState({ name: "", email: "", phone: "" })

  const filtered = useMemo(() => {
    if (!searchQuery) return customers
    const q = searchQuery.toLowerCase()
    return customers.filter(
      c => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)
    )
  }, [customers, searchQuery])

  useEffect(() => {
    let ignore = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch("/api/clients?pageSize=50").then(r => r.json())
        if (ignore) return
        const list = (res.clients || []).map((c: any) => ({
          id: c.id, name: c.firstName && c.lastName ? `${c.firstName} ${c.lastName}` : (c.firstName ?? c.username ?? "Customer"),
          email: c.email ?? null, phone: c.phoneNumber ?? null
        }))
        setCustomers(list)
      } catch (e) {
        console.error("load clients", e)
      } finally {
        if (!ignore) setLoading(false)
      }
    })()
    return () => { ignore = true }
  }, [])

  const handleSelect = (c: Customer | null) => {
    onSelectCustomer(c)
    setOpen(false)
    setSearchQuery("")
  }

  const handleAddCustomer = async () => {
    if (!newCustomer.name.trim()) return
    try {
      const [firstName, ...rest] = newCustomer.name.trim().split(" ")
      const body = {
        firstName,
        lastName: rest.join(" ") || null,
        email: newCustomer.email || null,
        phoneNumber: newCustomer.phone || null,
      }
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("Failed to create client")
      const c = await res.json()
      const customer: Customer = {
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || "Customer",
        email: c.email ?? null,
        phone: c.phoneNumber ?? null,
      }
      setCustomers(prev => [customer, ...prev])
      handleSelect(customer)
      setNewCustomer({ name: "", email: "", phone: "" })
      setShowNewCustomer(false)
    } catch (e) {
      console.error(e)
      alert("Could not add customer.")
    }
  }

  const createGuestNow = async () => {
    try {
      const body = { firstName: "Walk-in", lastName: null, email: null, phoneNumber: null }
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error("Failed to create guest")
      const c = await res.json()
      handleSelect({ id: c.id, name: "Walk-in", email: null, phone: null })
    } catch (e) {
      console.error(e)
      alert("Could not create guest client.")
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 bg-transparent">
          <User className="h-4 w-4" />
          {selectedCustomer ? selectedCustomer.name : "Select customer"}
          {selectedCustomer && (
            <X
              className="h-3 w-3 ml-1"
              onClick={(e) => {
                e.stopPropagation()
                onSelectCustomer(null)
              }}
            />
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Customer</DialogTitle>
        </DialogHeader>

        {!showNewCustomer ? (
          <div className="space-y-4">
            <Input
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <ScrollArea className="h-64">
              <div className="space-y-2">
                <Card
                  className="p-3 cursor-pointer hover:bg-accent transition-colors"
                  onClick={createGuestNow}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                      <User className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="font-medium">Walk-in (Guest)</p>
                      <p className="text-sm text-muted-foreground">Create a guest client and continue</p>
                    </div>
                  </div>
                </Card>

                {loading && <p className="px-2 text-sm text-muted-foreground">Loading…</p>}
                {filtered.map((c) => (
                  <Card
                    key={c.id}
                    className="p-3 cursor-pointer hover:bg-accent transition-colors"
                    onClick={() => handleSelect(c)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground">
                        {c.name.charAt(0)}
                      </div>
                      <div>
                        <p className="font-medium">{c.name}</p>
                        {c.email && <p className="text-sm text-muted-foreground">{c.email}</p>}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </ScrollArea>

            <Button variant="outline" className="w-full gap-2 bg-transparent" onClick={() => setShowNewCustomer(true)}>
              <UserPlus className="h-4 w-4" />
              Add New Customer
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={newCustomer.name}
                onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                placeholder="John Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={newCustomer.email}
                onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                placeholder="555-0101"
              />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 bg-transparent" onClick={() => setShowNewCustomer(false)}>
                Cancel
              </Button>
              <Button className="flex-1" onClick={handleAddCustomer}>
                Add Customer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
