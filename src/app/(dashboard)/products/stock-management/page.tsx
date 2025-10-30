// src/app/(dashboard)/products/stock-management/page.tsx
"use client";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";

import { StockManagementDataTable } from "../components/stock-management-data-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function StockManagementPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Stock Management") // Set the header title for this page
  }, [setHeaderTitle])

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Stock Management"
              description="Quickly view and update stock across warehouses and countries"
            />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About stock management"
            tooltip="What is stock management?"
            content={
              <>
                <p>
                  <strong>Stock management</strong> allows you to view, track, and update product inventory across your warehouses and sales regions in real time.
                </p>
                <p>
                  This view gives you a centralized way to manage stock by country or warehouse, making it easier to keep accurate quantities, prevent overselling, and ensure products are available where needed.
                </p>
                <p>
                  In the table below, you can quickly review stock levels and adjust quantities. Use the <strong>Edit</strong> buttons to update stock values or distribute inventory across different locations.
                </p>
              </>
            }
          />
        </div>
      </div>
      <Suspense fallback={<div>Loading stock management table...</div>}>
        <StockManagementDataTable />
      </Suspense>
    </div>
  );
}
