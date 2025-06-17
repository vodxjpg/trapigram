// /home/zodx/Desktop/Trapyfy/src/app/(dashboard)/announcements/new/page.tsx
"use client";

import { useEffect } from "react";
import { AnnouncementForm } from "../announcements-form";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import

export default function AnnouncementsNewPage() {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => {
    setHeaderTitle("New Announcement"); // Set the header title for this page
  }, [setHeaderTitle]);

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