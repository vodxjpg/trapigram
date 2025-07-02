// src/app/(dashboard)/notification-templates/new/page.tsx
"use client";

import { useEffect } from "react";
import { usePermission } from "@/hooks/use-permission";
import { useRouter } from "next/navigation";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { NotificationTemplateForm } from "../components/notification-templates-form";

export default function NewTemplatePage() {
  const { setHeaderTitle } = useHeaderTitle();
   const can = usePermission(); ;
  const router = useRouter();

  useEffect(() => {
    setHeaderTitle("New Notification Template");
  }, [setHeaderTitle]);

  // redirect if no create
  useEffect(() => {
    if (!can.loading && !can({ notifications: ["create"] })) {
      router.replace("/notification-templates");
    }
  }, [can, router]);

  if (can.loading || !can({ notifications: ["create"] })) return null;

  return (
    <div className="p-6">
      <NotificationTemplateForm />
    </div>
  );
}
