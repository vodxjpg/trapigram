"use client"

import useSWR from "swr"
import { useEffect } from "react"
import { useRouter } from "next/navigation"

export type Product = {
  id: string
  title: string
  image: string | null
  sku: string
  status: "published" | "draft"
  regularPrice: number
  salePrice: number | null
  stockStatus: "managed" | "unmanaged"
  categories: string[]
  createdAt: string
}

interface UseProductsOptions {
  page?: number
  pageSize?: number
  search?: string
  categoryId?: string
}

const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error("Failed to fetch products")
    error.message = await res.text()
    throw error
  }
  return res.json()
}

export function useProducts(options: UseProductsOptions = {}) {
  const router = useRouter()
  const { page = 1, pageSize = 10, search = "", categoryId } = options

  const queryParams = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
  })

  if (search) queryParams.append("search", search)
  if (categoryId) queryParams.append("categoryId", categoryId)

  const { data, error, isLoading, mutate } = useSWR(`/api/products?${queryParams.toString()}`, fetcher, {
    revalidateOnFocus: false,
  })

  // Handle authentication errors
  useEffect(() => {
    if (error && (error.message.includes("Unauthorized") || error.message.includes("No active organization"))) {
      router.push("/auth/signin")
    }
  }, [error, router])

  return {
    products: data?.products as Product[],
    totalPages: data?.totalPages || 0,
    currentPage: data?.currentPage || 1,
    isLoading,
    isError: error,
    mutate,
  }
}

export function useProduct(id: string) {
  const router = useRouter()
  const { data, error, isLoading, mutate } = useSWR(id ? `/api/products/${id}` : null, fetcher, {
    revalidateOnFocus: false,
  })

  // Handle authentication errors
  useEffect(() => {
    if (error && (error.message.includes("Unauthorized") || error.message.includes("No active organization"))) {
      router.push("/auth/signin")
    }
  }, [error, router])

  return {
    product: data?.product as Product | undefined,
    isLoading,
    isError: error,
    mutate,
  }
}
