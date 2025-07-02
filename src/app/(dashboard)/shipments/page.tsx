"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { usePermission } from "@/hooks/use-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { ShipmentsTable } from "./shipment-table";

export default function ShipmentsPage() {
  const { setHeaderTitle } = useHeaderTitle();
   const can = usePermission(); ;
  const router = useRouter();

  useEffect(() => {
    setHeaderTitle("Shipping methods");
  }, [setHeaderTitle]);

  // redirect if they can't view
  useEffect(() => {
    if (!can.loading && !can({ shipping: ["view"] })) {
      router.replace("/");
    }
  }, [can, router]);

  if (can.loading) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
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
