"use client"

import { useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProductForm } from "../components/product-form"
import { PageHeader } from "@/components/page-header"

export default function NewProductPage() {
  const router = useRouter()

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Products
      </Button>

      <PageHeader title="Create New Product" description="Add a new product to your catalog" />

      <ProductForm />
    </div>
  )
}
