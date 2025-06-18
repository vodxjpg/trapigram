"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { CouponsTable } from "./coupons-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react';
import { usePermission } from "@/hooks/use-permission";

export default function CategoriesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const can = usePermission();

  useEffect(() => {
    setHeaderTitle("Coupons");
  }, [setHeaderTitle]);

  // 1) Wait for permissions to resolve
  if (can.loading) return null;

  // 2) Redirect if they lack "view"
  if (!can({ coupon: ["view"] })) {
    router.replace("/"); // or wherever makes sense
    return null;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Coupons</h1>
        <p className="text-muted-foreground">Manage your coupons.</p>
      </div>
      <Suspense fallback={<div>Loading coupons table...</div>}>
        <CouponsTable />
      </Suspense>
    </div>
  );
}
