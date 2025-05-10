// src/hooks/use-affiliate-product.ts
import useSWR from "swr"

export interface AffiliateProductDetail {
  id: string
  title: string
  description: string | null
  image: string | null
  sku: string
  status: "published" | "draft"
  productType: "simple" | "variable"
  pointsPrice: Record<string, number>
  createdAt: string
}

const fetcher = (u: string) => fetch(u).then((r) => r.json())

export function useAffiliateProduct(id: string) {
  const { data, isLoading, error, mutate } = useSWR<{ product: AffiliateProductDetail }>(
    `/api/affiliate/products/${id}`,
    fetcher,
  )

  return {
    product: data?.product,
    isLoading,
    error,
    mutate,
  }
}
