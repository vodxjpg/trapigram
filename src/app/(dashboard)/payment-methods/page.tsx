// src/app/(dashboard)/payment-methods/page.tsx
"use client";

import { useEffect } from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethodsTable } from "./payment-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { usePermission } from "@/hooks/use-permission";

export default function PaymentMethodsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
   const can = usePermission(); ;

  useEffect(() => {
    setHeaderTitle("Payment Methods");
  }, [setHeaderTitle]);

  // Wait for permissions to load
  if (can.loading) return null;

  // Redirect if no view permission
  if (!can({ payment: ["view"] })) {
    router.replace("/");
    return null;
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Payment Methods</h1>
        <p className="text-muted-foreground">
          Manage your payment methods.
        </p>
      </div>
      <Suspense fallback={<div>Loading payment methods...</div>}>
        <PaymentMethodsTable />
      </Suspense>
    </div>
  );
}
