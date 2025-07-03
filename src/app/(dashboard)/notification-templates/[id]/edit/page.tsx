// src/app/(dashboard)/notification-templates/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { NotificationTemplateForm } from "../../components/notification-templates-form";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditTemplatePage() {
  const router = useRouter();
  const params = useParams() as { id: string };
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────── */
  const {
    hasPermission: canUpdate,
    isLoading:     permLoading,
  } = useHasPermission(orgId, { notifications: ["update"] });

  const [initial, setInitial] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setHeaderTitle("Edit Notification Template");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canUpdate) {
      router.replace("/notification-templates");
    }
  }, [permLoading, canUpdate, router]);

  useEffect(() => {
    if (!canUpdate) return;
    fetch(`/api/notification-templates/${params.id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load template");
        return res.json();
      })
      .then((data) => setInitial(data))
      .catch((err) => {
        toast.error(err.message);
        router.replace("/notification-templates");
      })
      .finally(() => setLoading(false));
  }, [params.id, canUpdate, router]);

  if (permLoading || !canUpdate) return null;

  return (
    <div className="p-6">
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <NotificationTemplateForm id={params.id} initial={initial} isEditing />
      )}
    </div>
  );
}
