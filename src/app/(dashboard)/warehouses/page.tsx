"use client";

import { useEffect } from "react";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { WarehouseTable } from "./warehouse-table";

export default function WarehousesPage() {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => {
    setHeaderTitle("Warehouses");
  }, [setHeaderTitle]);

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