// src/app/(dashboard)/notification-templates/new/page.tsx
"use client";

import { NotificationTemplateForm } from "../components/notification-templates-form"
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { useEffect } from "react";

export default function NewTemplatePage() {
  const { setHeaderTitle } = useHeaderTitle();
  useEffect(() => setHeaderTitle("New Notification Template"), [setHeaderTitle]);

  return (
    <div className="p-6">
      <NotificationTemplateForm />
    </div>
  );
}
