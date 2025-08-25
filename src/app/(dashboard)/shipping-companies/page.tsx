// src/app/(dashboard)/shipping-companies/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShippingMethodsTable } from "./shipping-companies-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

export default function ShippingCompaniesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // Active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  // Permission check
  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { shippingMethods: ["view"] });

  useEffect(() => {
    setHeaderTitle("Shipping Companies");
  }, [setHeaderTitle]);

  // Redirect away if they don't have view permission
  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Shipping Companies</h1>
        <p className="text-muted-foreground">
          Manage your Shipping Companies.
        </p>
      </div>
      <ShippingMethodsTable />
    </div>
  );
}
