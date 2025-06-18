"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { AffiliateProductForm } from "../components/affiliate-product-form";
import { useAffiliateProduct } from "@/hooks/use-affiliate-product";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermission } from "@/hooks/use-permission";

export default function EditAffiliateProductPage() {
  const router = useRouter();
  const params = useParams() as { id: string };
  const can = usePermission();
  const { product, isLoading } = useAffiliateProduct(params.id);

  // Redirect back if no products permission
  useEffect(() => {
    if (!can.loading && !can({ affiliates: ["products"] })) {
      router.replace("/affiliates");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ affiliates: ["products"] })) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="h-4 w-4 mr-2" />
        Back to Affiliate Products
      </Button>

      <PageHeader
        title={isLoading ? "Loading…" : `Edit: ${product?.title}`}
        description="Update affiliate product details"
      />

      {isLoading || !product ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-60 w-full" />
        </div>
      ) : (
        <AffiliateProductForm
          productId={params.id}
          initialData={product}
        />
      )}
    </div>
  );
}
