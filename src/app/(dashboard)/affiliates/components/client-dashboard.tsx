// src/app/(dashboard)/affiliates/client-dashboard.tsx
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "../../clients/components/clients-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function ClientDashboard() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Affiliates") // Set the header title for this page
  }, [setHeaderTitle])

  // get current org
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check permissions
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { affiliates: ["view"] });
  const { hasPermission: canPoints } = useHasPermission(organizationId, { affiliates: ["points"] });
  const { hasPermission: canLevels } = useHasPermission(organizationId, { affiliates: ["settings"] });
  const { hasPermission: canLogs } = useHasPermission(organizationId, { affiliates: ["logs"] });
  const { hasPermission: canProducts } = useHasPermission(organizationId, { affiliates: ["products"] });

  // redirect away if no view
  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading) return null;
  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to access the Affiliates dashboard.
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Affiliates"
              description="Manage client balances, levels and programme settings." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About affiliates"
            tooltip="What are affiliates?"
            content={
              <>
                <p>
                  <strong>Affiliates</strong> are partners or influencers who promote your products or services in exchange for commissions based on the sales or leads they generate.
                </p>
                <p>
                  Managing affiliates helps you track their performance, monitor referrals, and assign reward structures. This makes it easier to build and scale referral-based growth programs for your business.
                </p>
                <p>
                  In the table below, you can view, edit, or remove affiliates.
                </p>
              </>
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {canLevels && (
            <Link href="/affiliates/levels">
              <Button variant="secondary">Affiliate Levels</Button>
            </Link>
          )}
          {canLogs && (
            <Link href="/affiliates/registries">
              <Button variant="secondary">Affiliate Logs</Button>
            </Link>
          )}
          {canProducts && (
            <Link href="/affiliates/products">
              <Button variant="secondary">Affiliate Products</Button>
            </Link>
          )}
          {canLevels && (
            <Link href="/affiliates/settings">
              <Button variant="secondary">Affiliate Settings</Button>
            </Link>
          )}
        </div>
      </div>
      {canPoints ? (
        <Suspense fallback={<p className="text-sm">Loading clients…</p>}>
          <ClientsTable />
        </Suspense>
      ) : (
        <div className="py-6 text-center text-red-600">
          You don’t have permission to view affiliate points.
        </div>
      )}
    </div>
  );
}
