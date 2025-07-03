// src/app/(dashboard)/affiliates/products/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { AffiliateProductsDataTable } from "./components/affiliate-products-data-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function AffiliateProductsPage() {
  const router = useRouter();

  // active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  // permissions for affiliate products
  const {
    hasPermission: canProducts,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { affiliates: ["products"] });

  // redirect if not permitted
  useEffect(() => {
    if (!permLoading && !canProducts) {
      router.replace("/affiliates");
    }
  }, [permLoading, canProducts, router]);

  if (permLoading) return null;
  if (!canProducts) return null;

  // same flag for creation
  const canCreate = canProducts;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <PageHeader
        title="Affiliate Products"
        description="Products sold for points"
        actions={
          canCreate ? (
            <Button onClick={() => router.push("/affiliates/products/new")}>
              <Plus className="h-4 w-4 mr-2" />
              New Affiliate Product
            </Button>
          ) : null
        }
      />

      <AffiliateProductsDataTable />
    </div>
  );
}
