// src/app/(dashboard)/notification-templates/new/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { NotificationTemplateForm } from "../components/notification-templates-form";

export default function NewTemplatePage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────── */
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(orgId, { notifications: ["create"] });

  useEffect(() => {
    setHeaderTitle("New Notification Template");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace("/notification-templates");
    }
  }, [permLoading, canCreate, router]);

  if (permLoading || !canCreate) return null;

  return (
    <div className="p-6">
      <NotificationTemplateForm />
    </div>
  );
}
