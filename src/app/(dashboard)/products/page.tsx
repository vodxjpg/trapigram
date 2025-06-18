"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProductsDataTable } from "./components/products-data-table"
import { PageHeader } from "@/components/page-header"
import { Suspense } from 'react'; // Added Suspense import
import { usePermission } from "@/hooks/use-permission"

export default function ProductsPage() {
  const router = useRouter()
  const can = usePermission()
  const [isLoading, setIsLoading] = useState(false)
  
  // Wait until we know the role
  if (can.loading) return null
  
  // Deny access if user cannot view products
  if (!can({ product: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view products.
      </div>
    )
  } 

  const handleCreateProduct = () => {
    router.push("/products/new")
  }

  return (
      <div className="container mx-auto py-6 px-6 space-y-6">
        <PageHeader
          title="Products"
          description="Manage your product catalog"
          actions={
            can({ product: ["create"] }) && (
              <Button onClick={handleCreateProduct} disabled={isLoading}>
                <Plus className="mr-2 h-4 w-4" />
                Add Product
              </Button>
            )
          }
        />
        <Suspense fallback={<div>Loading products table...</div>}>
          <ProductsDataTable />
        </Suspense>
      </div>
    )
}