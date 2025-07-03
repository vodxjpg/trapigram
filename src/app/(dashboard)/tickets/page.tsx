// src/app/(dashboard)/organizations/[identifier]/tickets/page.tsx
"use client";

import { useEffect, useMemo }                 from "react";
import { useRouter }                          from "next/navigation";
import { Suspense }                           from "react";

import { authClient }                         from "@/lib/auth-client";
import { useHasPermission }                   from "@/hooks/use-has-permission";
import { useHeaderTitle }                     from "@/context/HeaderTitleContext";
import { TicketsTable }                       from "./ticket-table";

export default function TicketsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* active organisation id → permission check */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  const {
    hasPermission: viewPerm,
    isLoading:     viewLoading,
  } = useHasPermission(organizationId, { ticket: ["view"] });

  const canView = useMemo(() => !viewLoading && viewPerm, [viewLoading, viewPerm]);

  /* header & redirect */
  useEffect(() => {
    setHeaderTitle("Tickets");
    if (!viewLoading && !viewPerm) {
      router.replace("/dashboard");
    }
  }, [setHeaderTitle, viewLoading, viewPerm, router]);

  /* guards during resolve / redirect */
  if (viewLoading || !canView) return null;

  /* ------------------------------------------------------------ */
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">Manage your tickets</p>
      </div>

      <Suspense fallback={<div>Loading ticket table…</div>}>
        <TicketsTable />
      </Suspense>
    </div>
  );
}
