// src/app/(dashboard)/notification-templates/page.tsx
"use client";

import { useEffect } from "react";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { NotificationTemplatesTable } from "./components/notification-templates-table";
import { Suspense } from "react";

export default function NotificationTemplatesPage() {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => setHeaderTitle("Notification Templates"), [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Notification Templates</h1>
          <p className="text-muted-foreground">Create and manage e-mail / in-app template bodies.</p>
        </div>
        <Button asChild>
          <Link href="/notification-templates/new">New Template</Link>
        </Button>
      </div>
      <Suspense fallback={<div>Loading templates…</div>}>
        <NotificationTemplatesTable />
      </Suspense>
    </div>
  );
}
