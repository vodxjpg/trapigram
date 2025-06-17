// src/app/(dashboard)/affiliate-products/page.tsx
"use client"

import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/page-header"
import { AffiliateProductsDataTable } from "./components/affiliate-products-data-table"

export default function AffiliateProductsPage() {
  const router = useRouter()

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <PageHeader
        title="Affiliate Products"
        description="Products sold for points"
        actions={
          <Button onClick={() => router.push("/affiliates/products/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Affiliate Product
          </Button>
        }
      />

      <AffiliateProductsDataTable />
    </div>
  )
}
