// src/app/(dashboard)/products/stock-management/page.tsx
"use client";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { StockManagementDataTable } from "../components/stock-management-data-table";
export default function StockManagementPage() {
  const router = useRouter();

  /* ── active organisation id ─────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission check (stockManagement:view) ────────────────────── */
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { stockManagement: ["view"] });

  /* ── redirect if not allowed please ────────────────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/products");
    }
  }, [permLoading, canView, router]);

  /* during resolution or redirect */
  if (permLoading || !canView) return null;

  /* ── render ─────────────────────────────────────────────────────── */
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
