// src/app/(dashboard)/announcements/new/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnnouncementForm } from "../announcements-form";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react';
import { usePermission } from "@/hooks/use-permission";

export default function AnnouncementsNewPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const can = usePermission(organizationId);;

  const canCreate = can({ announcements: ["create"] });

  useEffect(() => {
    setHeaderTitle("New Announcement");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!can.loading && !canCreate) {
      router.replace("/announcements");
    }
  }, [can.loading, canCreate, router]);

  if (can.loading || !canCreate) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">New Announcement</h1>
        <p className="text-muted-foreground">Create a new announcement.</p>
      </div>
      <Suspense fallback={<div>Loading announcement form...</div>}>
        <AnnouncementForm />
      </Suspense>
    </div>
  );
}
