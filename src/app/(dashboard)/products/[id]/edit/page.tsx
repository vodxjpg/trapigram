"use client"

import { useParams, useRouter } from "next/navigation"
import { ChevronLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProductForm } from "../../components/product-form"
import { PageHeader } from "@/components/page-header"
import { useProduct } from "@/hooks/use-products"
import { Skeleton } from "@/components/ui/skeleton"

export default function EditProductPage() {
  const router = useRouter()
  const params = useParams() as { id: string }
  const { product, isLoading } = useProduct(params.id)

  return (
    <div className="container mx-auto py-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Products
      </Button>
      <PageHeader
        title={isLoading ? "Loading..." : `Edit Product: ${product?.title}`}
        description="Update product details"
      />
      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (
        <ProductForm productId={params.id} initialData={product} />
      )}
    </div>
  )
}
