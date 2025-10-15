// src/app/(dashboard)/tickets/page.tsx
"use client";

import { useEffect, useMemo } from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { TicketsTable } from "./ticket-table";

/* -------------------------------------------------------------------------- */
/*  Component                                                                 */
/* -------------------------------------------------------------------------- */

export default function TicketsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ---------- permissions ------------------------------------------------ */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const { hasPermission: viewPerm, isLoading: viewLoading } =
    useHasPermission(organizationId, { ticket: ["view"] });

  /* ---------- derived flag (always computed) ----------------------------- */
  const canView = useMemo(
    () => !viewLoading && viewPerm,
    [viewLoading, viewPerm],
  );

  /* ---------- side-effects (always run) ---------------------------------- */
  useEffect(() => {
    setHeaderTitle("Tickets");
    if (!viewLoading && !viewPerm) router.replace("/dashboard");
  }, [setHeaderTitle, viewLoading, viewPerm, router]);

  /* ---------- guards AFTER all hooks ------------------------------------ */
  if (viewLoading || !canView) return null;

  /* ---------- UI --------------------------------------------------------- */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Tickets</h1>
        <p className="text-muted-foreground">Manage your customer support tickets<br></br>
          use /ticketing_group COUNTRY_CODE (e.g IT) to make the bot send you notifications for tickets of that country in a telegram group</p>
      </div>

      <Suspense fallback={<div>Loading ticket table…</div>}>
        <TicketsTable />
      </Suspense>
    </div>
  );
}
