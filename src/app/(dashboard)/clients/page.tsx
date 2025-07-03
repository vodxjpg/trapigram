// src/app/(dashboard)/organizations/[identifier]/clients/page.tsx  ← keep path
"use client";

import { useEffect, useState }                from "react";
import { useRouter }                          from "next/navigation";
import { Plus }                               from "lucide-react";
import Link                                   from "next/link";

import { authClient }                         from "@/lib/auth-client";
import { useHasPermission }                   from "@/hooks/use-has-permission";   // ← NEW
import { Button }                             from "@/components/ui/button";
import { ClientsTable }                       from "./clients-table";

/* -------------------------------------------------------------------------- */

export default function ClientsPage() {
  const router = useRouter();

  /* ── active organisation → id for permission hook ────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── secure permission checks ─────────────────────────────────────────── */
  const {
    hasPermission: viewPerm,
    isLoading:     viewLoading,
  } = useHasPermission(organizationId, { customer: ["view"] });

  const {
    hasPermission: createPerm,
    isLoading:     createLoading,
  } = useHasPermission(organizationId, { customer: ["create"] });

  /* ── mirror legacy local state for minimal churn ─────────────────────── */
  const [mayView, setMayView] = useState<boolean | null>(null);

  useEffect(() => {
    if (!viewLoading) setMayView(viewPerm);
  }, [viewLoading, viewPerm]);

  /* ── guards ───────────────────────────────────────────────────────────── */
  if (mayView === null) return null;          // still resolving
  if (!mayView) {
    router.replace("/dashboard");
    return null;                              // redirect
  }

  const canCreate = createPerm && !createLoading;

  /* ── page ─────────────────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">Manage your client database</p>
        </div>
        {canCreate && (
          <Link href="/clients/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Client
            </Button>
          </Link>
        )}
      </div>
      <ClientsTable />
    </div>
  );
}
