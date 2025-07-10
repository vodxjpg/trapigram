// src/app/(dashboard)/notification-templates/page.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { NotificationTemplatesTable } from "./components/notification-templates-table";

export default function NotificationTemplatesPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────────── */
  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(orgId, { notifications: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(
    orgId,
    { notifications: ["create"] },
  );

  useEffect(() => {
    setHeaderTitle("Notification Templates");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading) return null;

  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view notification templates.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">
            Notification Templates
          </h1>
          <p className="text-muted-foreground">
            Create and manage e-mail / in-app template bodies <br></br>
            and use <b>/notification_group COUNTRY_CODE</b> (e.g IT) to make the bot send you notifications of that country in a telegram group
          </p>
        </div>
        {canCreate && (
          <Button asChild>
            <Link href="/notification-templates/new">New Template</Link>
          </Button>
        )}
      </div>

      <Suspense fallback={<div>Loading templates…</div>}>
        <NotificationTemplatesTable />
      </Suspense>
    </div>
  );
}
