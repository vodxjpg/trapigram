// src/app/(dashboard)/shipping-companies/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShippingMethodsTable } from "./components/shipping-companies-table";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function ShippingCompaniesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // Active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // Permission check
  const {
    hasPermission: canView,
    isLoading: permLoading,
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
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Shipping Companies"
              description="Manage your Shipping Companies." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About shipping companies"
            tooltip="What are shipping companies?"
            content={
              <>
                <p>
                  <strong>Shipping companies</strong> are the carriers that deliver your orders (e.g., DHL, DPD, UPS, Correos). Here you store their details, service levels, and tracking information used during fulfillment.
                </p>
                <p>
                  Linking carriers to your shipping methods helps define pickup options, delivery times, and SLAs by country or region. You can also record account numbers, contact info, and tracking URL patterns for label generation and notifications.
                </p>
                <p>
                  In the table below, you can create, edit, or delete shipping companies. Click the <strong>+</strong> button to add a new carrier and then assign it to your shipping methods or fulfillment workflows.
                </p>
              </>
            }
          />
        </div>
      </div>
      <ShippingMethodsTable />
    </div>
  );
}
