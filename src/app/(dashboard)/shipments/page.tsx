"use client";

import { useEffect } from "react";
import { ShipmentsTable } from "./shipment-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Shipments"); // Set the header title for this page
    }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Shipments</h1>
        <p className="text-muted-foreground">
          Manage your Shipments.
        </p>
      </div>
      <ShipmentsTable />
    </div>
  );
}