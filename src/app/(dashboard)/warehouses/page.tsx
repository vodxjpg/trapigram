// src/app/(dashboard)/warehouses/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { usePermission } from "@/hooks/use-permission";
import { WarehouseTable } from "./warehouse-table";

export default function WarehousesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const can = usePermission();

  useEffect(() => {
    setHeaderTitle("Warehouses");
  }, [setHeaderTitle]);

  if (can.loading) return null;

  if (!can({ warehouses: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view warehouses.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
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
