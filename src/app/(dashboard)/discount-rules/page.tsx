// /home/zodx/Desktop/trapigram/src/app/(dashboard)/discount-rules/page.tsx
// src/app/(dashboard)/discount-rules/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DiscountRulesTable } from "./components/discount-rules-table";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

const LOG = "[TierPricing/List]";

export default function DiscountRulesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // ── active organization ───────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // ── permissions ────────────────────────────────────────────────────────
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { tierPricing: ["view"] });
  const { hasPermission: canCreate } = useHasPermission(
    organizationId,
    { tierPricing: ["create"] },
  );

  useEffect(() => {
    setHeaderTitle("Tier pricing");
  }, [setHeaderTitle]);

  useEffect(() => {
    // lightweight visibility for diagnostics
    // eslint-disable-next-line no-console
    console.debug(`${LOG} mount`, { organizationId, permLoading, canView, canCreate });
  }, [organizationId, permLoading, canView, canCreate]);

  if (permLoading) return null;

  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view tier pricing.
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Tier pricing"
              description="Manage your tier pricing rules." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About tier pricing"
            tooltip="What is tier pricing?"
            content={
              <>
                <p>
                  <strong>Tier pricing</strong> allows you to offer automatic discounts when customers purchase products in larger quantities. This helps encourage bulk orders and reward higher-volume buyers.
                </p>
                <p>
                  Each tier can define a minimum quantity and a specific discount or price. When the customer meets the quantity requirement, the system applies the corresponding tier price automatically.
                </p>
                <p>
                  In the table below, you can view, edit, or delete pricing tiers. Click the <strong>+</strong> button to create a new tier and set your quantity thresholds and discounts.
                </p>
              </>
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button
              onClick={() => {
                // eslint-disable-next-line no-console
                console.debug(`${LOG} click Add Rule`);
                router.push("/discount-rules/new");
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Rule
            </Button>
          )}
        </div>
      </div>
      <Suspense fallback={<div>Loading tier pricing table…</div>}>
        <DiscountRulesTable />
      </Suspense>
    </div>
  );
}
