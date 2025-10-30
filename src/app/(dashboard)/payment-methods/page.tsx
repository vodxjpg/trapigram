// src/app/(dashboard)/payment-methods/page.tsx
"use client";

import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethodsTable } from "./components/payment-table";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function PaymentMethodsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // active organization for permission scope
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check view permission
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { payment: ["view"] });

  useEffect(() => {
    setHeaderTitle("Payment Methods");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Payment Methods"
              description="Manage your payment methods." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About payment methods"
            tooltip="What are payment methods?"
            content={
              <>
                <p>
                  <strong>Payment methods</strong> define how customers can pay for their orders. These may include options like credit/debit cards, bank transfers, cash on delivery, crypto payments, or external gateways.
                </p>
                <p>
                  Each payment method can have its own rules, availability, and settings — allowing you to tailor payment options by country, customer type, or sales channel. This gives flexibility in how you accept and process payments.
                </p>
                <p>
                  In the table below, you can create, edit, or delete payment methods. Click the <strong>+</strong> button to add a new payment option and configure how customers will be able to complete their purchase.
                </p>
              </>
            }
          />
        </div>
      </div>
      <Suspense fallback={<div>Loading payment methods...</div>}>
        <PaymentMethodsTable />
      </Suspense>
    </div>
  );
}
