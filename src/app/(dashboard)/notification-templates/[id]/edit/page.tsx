// src/app/(dashboard)/notification-templates/[id]/edit/page.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { usePermission } from "@/hooks/use-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { NotificationTemplateForm } from "../../components/notification-templates-form";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditTemplatePage() {
  const { id } = useParams();
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();
   const can = usePermission(); ;

  const [initial, setInitial] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setHeaderTitle("Edit Notification Template");
  }, [setHeaderTitle]);

  // redirect if no update
  useEffect(() => {
    if (!can.loading && !can({ notifications: ["update"] })) {
      router.replace("/notification-templates");
    }
  }, [can, router]);

  useEffect(() => {
    if (!can({ notifications: ["update"] })) return;
    fetch(`/api/notification-templates/${id}`)
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
  }, [id, can, router]);

  if (can.loading || !can({ notifications: ["update"] })) return null;

  return (
    <div className="p-6">
      {loading ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <NotificationTemplateForm id={id} initial={initial} isEditing />
      )}
    </div>
  );
}
