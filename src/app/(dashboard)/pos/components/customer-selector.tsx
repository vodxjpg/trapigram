// src/app/(dashboard)/pos/components/customer-selector.tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { User, UserPlus, X } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card } from "@/components/ui/card"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"

import Select from "react-select"
import ReactCountryFlag from "react-country-flag"
import countriesLib from "i18n-iso-countries"
import enLocale from "i18n-iso-countries/langs/en.json"

countriesLib.registerLocale(enLocale)

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

type NewCustomerForm = {
  username: string
  firstName: string
  lastName: string
  email: string
  phoneNumber: string
  country: string // ISO-2 code
}

type CountryOption = { value: string; label: React.ReactNode }

export function CustomerSelector({ selectedCustomer, onSelectCustomer }: CustomerSelectorProps) {
  const [open, setOpen] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [error, setError] = useState<string | null>(null)

  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>({
    username: "",
    firstName: "",
    lastName: "",
    email: "",
    phoneNumber: "",
    country: "",
  })

  const filtered = useMemo(() => {
    if (!searchQuery) return customers
    const q = searchQuery.toLowerCase()
    return customers.filter(
      c => c.name.toLowerCase().includes(q) || (c.email ?? "").toLowerCase().includes(q)
    )
  }, [customers, searchQuery])

  useEffect(() => {
    let ignore = false
    const load = async () => {
      setLoading(true)
      try {
        const url = new URL("/api/clients", window.location.origin)
        url.searchParams.set("page", "1")
        url.searchParams.set("pageSize", "200")
        if (searchQuery.trim()) url.searchParams.set("search", searchQuery.trim())
        const res = await fetch(url.toString())
        if (!res.ok) throw new Error("Failed to load clients")
        const j = await res.json()
        if (ignore) return
        const list: Customer[] = (j.clients || []).map((c: any) => ({
          id: c.id,
          name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || "Customer",
          email: c.email ?? null,
          phone: c.phoneNumber ?? null,
        }))
        setCustomers(list)
      } catch (e: any) {
        if (!ignore) setError(e?.message || "Failed to load clients")
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    load()
    return () => { ignore = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchQuery])

  // Country options (same approach as Clients form)
  const countryOptions: CountryOption[] = useMemo(() => {
    return Object.entries(countriesLib.getNames("en")).map(([code, name]) => ({
      value: code,
      label: (
        <div className="flex items-center">
          <ReactCountryFlag
            countryCode={code}
            svg
            style={{ width: "1em", height: "1em", marginRight: 8 }}
          />
          {name}
        </div>
      ),
    }))
  }, [])

  const handleSelect = (c: Customer | null) => {
    onSelectCustomer(c)
    setOpen(false)
    setSearchQuery("")
  }

  const handleAddCustomer = async () => {
    if (!newCustomer.firstName || !newCustomer.username) {
      setError("First name and username are required.")
      return
    }
    try {
      const body = {
        username: newCustomer.username,
        firstName: newCustomer.firstName,
        // DB requires lastName NOT NULL; default if blank
        lastName: newCustomer.lastName?.trim() ? newCustomer.lastName : "Customer",
        email: newCustomer.email || null,
        phoneNumber: newCustomer.phoneNumber || null,
        country: newCustomer.country || null,
      }
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e?.error || "Failed to create client")
      }
      const c = await res.json()
      const customer: Customer = {
        id: c.id,
        name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.username || "Customer",
        email: c.email ?? null,
        phone: c.phoneNumber ?? null,
      }
      setCustomers(prev => [customer, ...prev])
      handleSelect(customer)
      setNewCustomer({
        username: "",
        firstName: "",
        lastName: "",
        email: "",
        phoneNumber: "",
        country: "",
      })
      setShowNewCustomer(false)
    } catch (e: any) {
      setError(e?.message || "Could not add customer.")
    }
  }

  const createGuestNow = async () => {
    try {
      const body = {
        username: `walkin-${Date.now()}`,
        firstName: "Walk-in",
        lastName: "Customer",  // satisfy NOT NULL
        email: null,
        phoneNumber: null,
        country: null,
      }
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error(e?.error || "Failed to create guest")
      }
      const c = await res.json()
      handleSelect({ id: c.id, name: "Walk-in", email: null, phone: null })
    } catch (e: any) {
      setError(e?.message || "Could not create guest client.")
    }
  }

  return (
    <>
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
                placeholder="Search customers (name, username, email)…"
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Username *</Label>
                  <Input
                    value={newCustomer.username}
                    onChange={(e) => setNewCustomer({ ...newCustomer, username: e.target.value })}
                    placeholder="unique-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label>First Name *</Label>
                  <Input
                    value={newCustomer.firstName}
                    onChange={(e) => setNewCustomer({ ...newCustomer, firstName: e.target.value })}
                    placeholder="John"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Last Name</Label>
                  <Input
                    value={newCustomer.lastName}
                    onChange={(e) => setNewCustomer({ ...newCustomer, lastName: e.target.value })}
                    placeholder="Doe"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={newCustomer.email}
                    onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                    placeholder="john@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Phone</Label>
                  <Input
                    value={newCustomer.phoneNumber}
                    onChange={(e) => setNewCustomer({ ...newCustomer, phoneNumber: e.target.value })}
                    placeholder="555-0101"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Country</Label>
                  <Select
                    options={countryOptions}
                    value={countryOptions.find((opt) => opt.value === newCustomer.country) || null}
                    onChange={(opt) =>
                      setNewCustomer({ ...newCustomer, country: opt ? String(opt.value) : "" })
                    }
                    placeholder="Select a country"
                    isClearable
                  />
                </div>
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

      {/* Error dialog */}
      <AlertDialog open={!!error} onOpenChange={(o) => !o && setError(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Something went wrong</AlertDialogTitle>
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
