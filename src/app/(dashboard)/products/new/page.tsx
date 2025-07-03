"use client";

import { useEffect }          from "react";
import { useRouter }          from "next/navigation";
import { ChevronLeft }        from "lucide-react";

import { Button }             from "@/components/ui/button";
import { PageHeader }         from "@/components/page-header";
import { ProductForm }        from "../components/product-form";

import { authClient }         from "@/lib/auth-client";
import { useHasPermission }   from "@/hooks/use-has-permission";

export default function NewProductPage() {
  const router = useRouter();

  /* ── active organisation id ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── permission flag (product:create) ─────────────────────────────── */
  const {
    hasPermission: canCreateProduct,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { product: ["create"] });

  /* ── redirect if the user lacks permission ────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canCreateProduct) {
      router.replace("/products");
    }
  }, [permLoading, canCreateProduct, router]);

  /* guards while resolving / redirecting */
  if (permLoading || !canCreateProduct) return null;

  /* ------------------------------------------------------------------ */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <Button variant="ghost" className="mb-6" onClick={() => router.back()}>
        <ChevronLeft className="mr-2 h-4 w-4" />
        Back to Products
      </Button>

      <PageHeader
        title="Create New Product"
        description="Add a new product to your catalog"
      />

      <ProductForm />
    </div>
  );
}