// src/app/(dashboard)/warehouses/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { WarehouseTable } from "./components/warehouse-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function WarehousesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // get active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check view permission on warehouses
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { warehouses: ["view"] });

  useEffect(() => {
    setHeaderTitle("Warehouses");
  }, [setHeaderTitle]);

  // wait for permission resolution
  if (permLoading) return null;

  // show error if not allowed
  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view warehouses.
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Warehouses</h1>
        <p className="text-muted-foreground">
          Manage your warehouses and their associated organizations and countries.
        </p>
      </div>
      <WarehouseTable />
    </div>
  );
}
