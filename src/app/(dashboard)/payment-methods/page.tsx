"use client";

import { useEffect } from "react";
import { PaymentMethodsTable } from "./payment-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import


export default function CategoriesPage() {
    const { setHeaderTitle } = useHeaderTitle();

    useEffect(() => {
        setHeaderTitle("Product categories"); // Set the header title for this page
    }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Payment methods</h1>
        <p className="text-muted-foreground">
          Manage your payment methods.
        </p>
      </div>
      <Suspense fallback={<div>Loading ayment methods table...</div>}>
        <PaymentMethodsTable />
      </Suspense>
    </div>
  );
}
