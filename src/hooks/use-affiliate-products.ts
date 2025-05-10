// src/hooks/use-affiliate-products.ts
import useSWR from "swr"

export interface AffiliateProduct {
  id: string
  title: string
  image: string | null
  sku: string
  status: "published" | "draft"
  productType: "simple" | "variable"
  pointsPrice: Record<string, number>
  createdAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function useAffiliateProducts() {
  const { data, error, isLoading, mutate } = useSWR<{ products: AffiliateProduct[] }>(
    "/api/affiliate/products?limit=100",
    fetcher,
  )
  return {
    products: data?.products || [],
    isLoading,
    error,
    mutate,
  }
}
