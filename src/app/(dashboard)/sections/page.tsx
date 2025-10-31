// src/app/(dashboard)/sections/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionsTable } from "./components/sections-table";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function SectionsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  useEffect(() => {
    setHeaderTitle("Sections");
  }, [setHeaderTitle]);

  // 1) Read active org FIRST and gate on it
  const { data: activeOrg } = authClient.useActiveOrganization();

  // While the active org is not resolved yet, render nothing.
  // (Prevents downstream hooks from being called with changing assumptions)
  if (activeOrg === undefined) return null;

  const organizationId = activeOrg?.id ?? null;

  // 2) Now it’s safe to call permission hooks (order won’t change between renders)
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { sections: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    sections: ["create"],
  });

  // redirect if not allowed to view
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
              title="Sections"
              description="Manage your sections." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About sections"
            tooltip="What are bot sections?"
            content={
              <>
                <p>
                  <strong>Sections</strong> allow you to edit the text and content shown in different areas of your Telegram bot, helping you customize the user experience and communication tone.
                </p>
                <p>
                  Each section represents a specific part of your bot’s interface or flow (such as welcome messages, menus, instructions, or help screens). Updating these sections lets you tailor the messaging to your brand and audience.
                </p>
                <p>
                  In the table below, you can view and edit each section’s content. Click on a section to modify its text and update what users see inside your bot.
                </p>
              </>
            }
          />
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button className="hidden" onClick={() => router.push("/sections/new")}>
              <Plus className="mr-2 h-4 w-4" />
              New Section
            </Button>
          )}
        </div>
      </div>
      <SectionsTable />
    </div>
  );
}
