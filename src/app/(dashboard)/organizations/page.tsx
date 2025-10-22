"use client"

import { useEffect } from "react"
import { OrganizationTable } from "./components/organization-table"
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function OrganizationsPage() {
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Organizations") // Set the header title for this page
  }, [setHeaderTitle])

  return (
    <div className="container mx-auto py-8 px-4 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Organizations</h1>
        <p className="text-muted-foreground">Manage your organizations and their members.</p>
      </div>
      <OrganizationTable />

    </div>
  )
}

