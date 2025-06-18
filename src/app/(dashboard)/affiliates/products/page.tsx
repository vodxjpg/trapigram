"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { AffiliateProductsDataTable } from "./components/affiliate-products-data-table";
import { usePermission } from "@/hooks/use-permission";

export default function AffiliateProductsPage() {
  const router = useRouter();
  const can = usePermission();

  // Redirect back if no products permission
  useEffect(() => {
    if (!can.loading && !can({ affiliates: ["products"] })) {
      router.replace("/affiliates");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ affiliates: ["products"] })) return null;

  const canCreate = can({ affiliates: ["products"] });

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
