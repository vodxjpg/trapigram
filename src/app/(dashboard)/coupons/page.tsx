"use client";

import { useEffect } from "react";
import { CouponsTable } from "./coupons-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import

export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Coupons"); // Set the header title for this page
    }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Coupons</h1>
        <p className="text-muted-foreground">
          Manage your coupons.
        </p>
      </div>
      <Suspense fallback={<div>Loading coupons table...</div>}>
        <CouponsTable />
      </Suspense>
    </div>
  );
}