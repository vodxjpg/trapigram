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
  const obj = pointsPrice as Record<string, unknown>;

  // Case 1: already nested per-level -> keep as-is
  const maybeLevel = (obj as any).default ?? Object.values(obj)[0];
  if (
    maybeLevel &&
    typeof maybeLevel === "object" &&
    Object.values(maybeLevel as Record<string, unknown>).some(
      (v) => v && typeof v === "object" && "regular" in (v as Record<string, unknown>),
    )
  ) {
    return obj as unknown as NestedPoints;
  }

  // Case 2: flat per-country numbers -> convert to nested default
  const entries = Object.entries(obj);
  if (entries.length && entries.every(([, v]) => typeof v === "number")) {
    const out: NestedPoints = { default: {} };
    for (const [country, value] of entries) {
      out.default[country] = { regular: Number(value) || 0, sale: null };
    }
    return out;
  }

  return undefined;
}

function normalizeInitialData(product: any) {
  if (!product) return undefined;
  const { pointsPrice, ...rest } = product;
  const nested = normalizePointsPrice(pointsPrice);
  return {
    ...rest,
    // keep server nested map if normalize didn’t convert anything
    pointsPrice: nested ?? (pointsPrice as any),
  };
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
