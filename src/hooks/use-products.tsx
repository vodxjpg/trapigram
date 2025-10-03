// src/hooks/use-products.ts
import useSWR from "swr"
import type { Product } from "@/types/product"

interface UseProductsProps {
  page: number
  pageSize: number
  search?: string
  /* ───────── new optional filters ───────── */
  status?: "published" | "draft"
  categoryId?: string
  attributeId?: string
  attributeTermId?: string
  orderBy?: "createdAt" | "updatedAt" | "title" | "sku"
  orderDir?: "asc" | "desc"
}

// Generic fetcher returns parsed JSON directly
const fetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error("Failed to fetch products")
  }
  return await response.json()
}

// Hook for paginated product list
export function useProducts({
  page,
  pageSize,
  search,
  status,
  categoryId,
  attributeId,
  attributeTermId,
  orderBy,
  orderDir,
}: UseProductsProps) {
  const params = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(categoryId ? { categoryId } : {}),
    ...(attributeId ? { attributeId } : {}),
    ...(attributeTermId ? { attributeTermId } : {}),
    ...(orderBy ? { orderBy } : {}),
    ...(orderDir ? { orderDir } : {}),
  })

  const { data, error, mutate } = useSWR<{
    products: Product[]
    pagination: { totalPages: number }
  }>(
    `/api/products?${params.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  console.log(data)

  return {
    products: data?.products || [],
    isLoading: !data && !error,
    totalPages: data?.pagination?.totalPages ?? 1,
    mutate,
  }
}

// Fetcher for a single product, extracting the nested `product` object
const singleProductFetcher = async (url: string) => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error("Failed to fetch product")
  }
  const json = await response.json()
  return json.product as Product
}

// Hook for a single product only
export function useProduct(productId: string) {
  const { data, error, mutate } = useSWR<Product>(
    productId ? `/api/products/${productId}` : null,
    singleProductFetcher,
    { revalidateOnFocus: false }
  )

  return {
    product: data ?? null,
    isLoading: !data && !error,
    mutate,
  }
}
