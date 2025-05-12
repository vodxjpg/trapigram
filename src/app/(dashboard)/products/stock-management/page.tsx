// src/app/(dashboard)/products/stock-management/page.tsx
"use client"

import { Suspense } from "react"
import { PageHeader } from "@/components/page-header"
import { StockManagementDataTable } from "../components/stock-management-data-table"

export default function StockManagementPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <PageHeader
        title="Stock Management"
        description="Quickly view and update stock across warehouses and countries"
      />
      <Suspense fallback={<div>Loading stock management table...</div>}>
        <StockManagementDataTable />
      </Suspense>
    </div>
  )
}
