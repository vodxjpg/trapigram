// src/app/(dashboard)/announcements/page.tsx
"use client";

import { useEffect }                 from "react";
import { useRouter }                 from "next/navigation";
import { Suspense }                  from "react";
import { Plus }                      from "lucide-react";

import { AnnouncementsTable }        from "./announcements-table";
import { useHeaderTitle }            from "@/context/HeaderTitleContext";
import { Button }                    from "@/components/ui/button";
import { authClient }                from "@/lib/auth-client";
import { useHasPermission }          from "@/hooks/use-has-permission";

/* -------------------------------------------------------------------------- */

export default function AnnouncementsPage() {
  const router          = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* active org → id for permission check */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* permissions */
  const {
    hasPermission: canView,
    isLoading:     viewLoading,
  } = useHasPermission(organizationId, { announcements: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(
    organizationId,
    { announcements: ["create"] },
  );

  /* set page title */
  useEffect(() => {
    setHeaderTitle("Announcements");
  }, [setHeaderTitle]);

  /* redirect if not allowed */
  useEffect(() => {
    if (!viewLoading && !canView) {
      router.replace("/");
    }
  }, [viewLoading, canView, router]);

  /* guards */
  if (viewLoading || !canView) return null;

  /* page */
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between sm:flex-wrap">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Announcements</h1>
          <p className="text-muted-foreground">Manage your announcements.</p>
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
