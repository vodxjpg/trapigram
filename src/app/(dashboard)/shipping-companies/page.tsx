// src/app/(dashboard)/shipping-companies/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShippingMethodsTable } from "./shipping-companies-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { usePermission } from "@/hooks/use-permission";

export default function ShippingCompaniesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
   const can = usePermission(); ;

  useEffect(() => {
    setHeaderTitle("Shipping Companies");
  }, [setHeaderTitle]);

  if (can.loading) return null;
  if (!can({ shippingMethods: ["view"] })) {
    router.replace("/");
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
