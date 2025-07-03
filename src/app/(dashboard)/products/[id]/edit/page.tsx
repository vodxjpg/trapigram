/* -------------------------------------------------------------------------- */
/*  EDIT-PRODUCT PAGE – permission-aware                                       */
/* -------------------------------------------------------------------------- */
"use client";

import { useEffect }             from "react";
import { useParams, useRouter }  from "next/navigation";
import useSWR                    from "swr";
import { ChevronLeft }           from "lucide-react";

import { Button }                from "@/components/ui/button";
import { PageHeader }            from "@/components/page-header";
import { ProductForm }           from "../../components/product-form";
import { Skeleton }              from "@/components/ui/skeleton";

import { authClient }            from "@/lib/auth-client";
import { useHasPermission }      from "@/hooks/use-has-permission";

import type { Product }          from "@/types/product";  /* adjust if needed */

export default function EditProductPage() {
  const router = useRouter();
  const params = useParams() as { id: string };

  /* ── active organisation id ──────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── permission flag (product:update) ─────────────────────────── */
  const {
    hasPermission: canUpdateProduct,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { product: ["update"] });

  /* ── redirect if permission denied ────────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canUpdateProduct) {
      router.replace("/products");
    }
  }, [permLoading, canUpdateProduct, router]);

  /* guard while resolving / redirecting */
  if (permLoading || !canUpdateProduct) return null;

  /* ── fetch product when allowed ───────────────────────────────── */
  const { data, error } = useSWR(
    `/api/products/${params.id}`,
    async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load product");
      return res.json() as Promise<{ product: Product; shared: boolean }>;
    },
  );

  const isLoading = !data && !error;
  const product   = data?.product;
  const shared    = data?.shared;

  /* ── render ───────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
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
        <ProductForm
          productId={params.id}
          initialData={product}
          shared={shared}
        />
      )}
    </div>
  );
}

