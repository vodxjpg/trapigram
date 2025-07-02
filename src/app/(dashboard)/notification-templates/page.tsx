// src/app/(dashboard)/notification-templates/page.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";
import { usePermission } from "@/hooks/use-permission";
import { NotificationTemplatesTable } from "./components/notification-templates-table";

export default function NotificationTemplatesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const can = usePermission(organizationId);;

  useEffect(() => {
    setHeaderTitle("Notification Templates");
  }, [setHeaderTitle]);

  if (can.loading) return null;
  if (!can({ notifications: ["view"] })) {
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
          <h1 className="text-3xl font-bold tracking-tight">Notification Templates</h1>
          <p className="text-muted-foreground">
            Create and manage e-mail / in-app template bodies.
          </p>
        </div>
        {can({ notifications: ["create"] }) && (
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
