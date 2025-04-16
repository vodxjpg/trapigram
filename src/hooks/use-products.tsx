import { useEffect, useState } from "react";
import useSWR from "swr";
import type { Product } from "@/types/product";

interface UseProductsProps {
  page: number;
  pageSize: number;
  search?: string;
}

const fetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch products");
  }
  const data = await response.json();
  return {
    ...data,
    products: data.products.map((product: any) => ({
      ...product,
      regularPrice: Number(product.regular_price),
      salePrice: product.sale_price ? Number(product.sale_price) : null,
      productType: product.product_type,
      createdAt: product.created_at,
      stockData: product.stock_data,
      stockStatus: product.stock_status,
      categories: product.categories, // Already names from API
    })),
  };
};

const singleProductFetcher = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch product");
  }
  const data = await response.json();
  return {
    ...data.product,
    regularPrice: Number(data.product.regular_price),
    salePrice: data.product.sale_price ? Number(data.product.sale_price) : null,
    productType: data.product.product_type,
    createdAt: data.product.created_at,
    stockData: data.product.stock_data,
    stockStatus: data.product.stock_status,
    categories: data.product.categories, // Names from API
    attributes: data.product.attributes || [],
    variations: data.product.variations || [],
  };
};

export function useProducts({ page, pageSize, search }: UseProductsProps) {
  const searchParams = new URLSearchParams({
    page: page.toString(),
    pageSize: pageSize.toString(),
    ...(search && { search }),
  });

  const { data, error, mutate } = useSWR(
    `/api/products?${searchParams.toString()}`,
    fetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    products: data?.products || [],
    isLoading: !data && !error,
    totalPages: data?.pagination?.totalPages || 1,
    mutate,
  };
}

export function useProduct(productId: string) {
  const { data, error, mutate } = useSWR(
    `/api/products/${productId}`,
    singleProductFetcher,
    {
      revalidateOnFocus: false,
    }
  );

  return {
    product: data,
    isLoading: !data && !error,
    mutate,
  };
}