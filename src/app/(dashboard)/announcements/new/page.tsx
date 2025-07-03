// src/app/(dashboard)/announcements/new/page.tsx
"use client";

import { useEffect }                 from "react";
import { useRouter }                 from "next/navigation";
import { Suspense }                  from "react";

import { AnnouncementForm }          from "../announcements-form";
import { useHeaderTitle }            from "@/context/HeaderTitleContext";
import { authClient }                from "@/lib/auth-client";
import { useHasPermission }          from "@/hooks/use-has-permission";

/* -------------------------------------------------------------------------- */

export default function AnnouncementsNewPage() {
  const router            = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* active org → id */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* permission */
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { announcements: ["create"] });

  /* set page title */
  useEffect(() => {
    setHeaderTitle("New Announcement");
  }, [setHeaderTitle]);

  /* redirect if not allowed */
  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace("/announcements");
    }
  }, [permLoading, canCreate, router]);

  /* guards */
  if (permLoading || !canCreate) return null;

  /* page */
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
