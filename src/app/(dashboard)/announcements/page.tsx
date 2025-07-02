// src/app/(dashboard)/announcements/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnnouncementsTable } from "./announcements-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react';
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { usePermission } from "@/hooks/use-permission";

export default function AnnouncementsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
   const can = usePermission(); ;

  const canView   = can({ announcements: ["view"] });
  const canCreate = can({ announcements: ["create"] });

  useEffect(() => {
    setHeaderTitle("Announcements");
  }, [setHeaderTitle]);

  // redirect or hide if no view
  useEffect(() => {
    if (!can.loading && !canView) {
      router.replace("/");
    }
  }, [can.loading, canView, router]);

  if (can.loading || !canView) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground">
            Manage your announcements.
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push("/announcements/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Announcement
          </Button>
        )}
      </div>
      <Suspense fallback={<div>Loading announcements table...</div>}>
        <AnnouncementsTable />
      </Suspense>
    </div>
  );
}
