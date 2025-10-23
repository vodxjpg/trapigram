// src/app/(dashboard)/affiliates/products/[id]/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { AffiliateProductForm } from "../components/affiliate-product-form";
import { useAffiliateProduct } from "@/hooks/use-affiliate-product";
import { Skeleton } from "@/components/ui/skeleton";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

type FlatPoints = Record<string, number>;
type NestedPoints =
  Record<string, Record<string, { regular: number; sale: number | null }>>;

function normalizePointsPrice(pointsPrice: unknown): NestedPoints | undefined {
  if (!pointsPrice || typeof pointsPrice !== "object" || Array.isArray(pointsPrice)) return undefined;

  const entries = Object.entries(pointsPrice as Record<string, unknown>);
  if (!entries.every(([, v]) => typeof v === "number")) return undefined;

  const out: NestedPoints = { default: {} };
  for (const [country, value] of entries) {
    out.default[country] = { regular: Number(value as number) || 0, sale: null };
  }
  return out;
}

function normalizeInitialData(product: any) {
  if (!product) return undefined;

  const { pointsPrice, ...rest } = product as { pointsPrice?: FlatPoints };
  const normalized: any = { ...rest };

  // Only attach if we can convert it to the nested structure the form expects
  const nested = normalizePointsPrice(pointsPrice);
  if (nested) normalized.pointsPrice = nested;

  return normalized;
}

export default function EditAffiliateProductPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  // Active organization → permission context
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // Check affiliates:products permission
  const {
    hasPermission: canEdit,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { affiliates: ["products"] });

  // Fetch product data
  const { product, isLoading: productLoading } = useAffiliateProduct(id);

  // Normalize here to satisfy AffiliateProductForm typings
  const initialData = useMemo(() => normalizeInitialData(product), [product]);

  // Redirect if unauthorized
  useEffect(() => {
    if (!permLoading && !canEdit) {
      router.replace("/affiliates/products");
    }
  }, [permLoading, canEdit, router]);

  if (permLoading) return null;
  if (!canEdit) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Affiliate Products
      </Button>

      <PageHeader
        title={productLoading ? "Loading…" : `Edit: ${product?.title ?? ""}`}
        description="Update affiliate product details"
      />

      {productLoading || !product ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : (
        <AffiliateProductForm
          productId={id}
          initialData={initialData}
        />
      )}
    </div>
  );
}
