// src/app/(dashboard)/announcements/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";
import { Plus } from "lucide-react";

import { AnnouncementsTable } from "./components/announcements-table";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

/* -------------------------------------------------------------------------- */

export default function AnnouncementsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* active org → id for permission check */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* permissions */
  const {
    hasPermission: canView,
    isLoading: viewLoading,
  } = useHasPermission(organizationId, { announcements: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(
    organizationId,
    { announcements: ["create"] },
  );

  /* set page title */
  useEffect(() => {
    setHeaderTitle("Announcements");
  }, [setHeaderTitle]);

  /* redirect if not allowed */
  useEffect(() => {
    if (!viewLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [viewLoading, canView, router]);

  /* guards */
  if (viewLoading || !canView) return null;

  /* page */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Announcements"
              description="Manage your announcements." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About announcements"
            tooltip="What are announcements?"
            content={
              <>
                <p>
                  <strong>Announcements</strong> let you send important updates, promotions, or notifications directly to your users through your Telegram bot.
                </p>
                <p>
                  They are useful for sharing news, feature updates, product launches, special offers, or any information you want your audience to receive instantly and directly on Telegram.
                </p>
                <p>
                  In the table below, you can view past announcements or create a new one. Click the <strong>+</strong> button to write and send a message to all connected users through your bot.
                </p>
              </>
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button onClick={() => router.push("/announcements/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Announcement
            </Button>
          )}
        </div>
      </div>
      <Suspense fallback={<div>Loading announcements table...</div>}>
        <AnnouncementsTable />
      </Suspense>
    </div>
  );
}
