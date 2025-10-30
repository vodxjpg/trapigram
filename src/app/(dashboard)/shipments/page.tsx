// src/app/(dashboard)/shipments/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { ShipmentsTable } from "./components/shipment-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function ShipmentsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────── */
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(orgId, { shipping: ["view"] });

  useEffect(() => {
    setHeaderTitle("Shipping methods");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Shipping methods"
              description="Manage your shipping methods." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About shipping methods"
            tooltip="How do shipping methods work?"
            content={
              <>
                <p>
                  <strong>Shipping methods</strong> determine the delivery cost for orders based on the customer’s country and the order total. This allows you to configure different shipping rules depending on regions and price thresholds.
                </p>
                <p>
                  Each shipping method can include minimum and maximum order amounts, as well as a specific shipping fee for that range. This helps you set progressive delivery pricing — for example, free shipping above a certain amount or higher fees for small orders.
                </p>
                <p>
                  In the table below, you can create, edit, or delete shipping methods by country. Click the <strong>+</strong> button to add a new rule and set the country, order amount range, and shipping cost.
                </p>
              </>
            }
          />
        </div>
      </div>
      <ShipmentsTable />
    </div>
  );
}
