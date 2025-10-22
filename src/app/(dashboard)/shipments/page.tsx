// src/app/(dashboard)/shipments/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { ShipmentsTable } from "./components/shipment-table";

export default function ShipmentsPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation ───────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  /* ── permissions ───────────────────────────────────────────────── */
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(orgId, { shipping: ["view"] });

  useEffect(() => {
    setHeaderTitle("Shipping methods");
  }, [setHeaderTitle]);

  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Shipping methods</h1>
        <p className="text-muted-foreground">
          Manage your shipping methods.
        </p>
      </div>
      <ShipmentsTable />
    </div>
  );
}
