// src/app/(dashboard)/products/stock-management/page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermission } from "@/hooks/use-permission";
import { PageHeader } from "@/components/page-header";
import { StockManagementDataTable } from "../components/stock-management-data-table";

export default function StockManagementPage() {
  const can = usePermission();
  const router = useRouter();

  // Redirect away if they lack "view"
  useEffect(() => {
    if (!can.loading && !can({ stockManagement: ["view"] })) {
      router.replace("/products");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ stockManagement: ["view"] })) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <PageHeader
        title="Stock Management"
        description="Quickly view and update stock across warehouses and countries"
      />
      <Suspense fallback={<div>Loading stock management table...</div>}>
        <StockManagementDataTable />
      </Suspense>
    </div>
  );
}
