// src/app/(dashboard)/payment-methods/page.tsx
"use client";

import { useEffect } from "react";
import { Suspense } from "react";
import { useRouter } from "next/navigation";
import { PaymentMethodsTable } from "./payment-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

export default function PaymentMethodsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  /* active organization for permission scope */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* check view permission */
  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { payment: ["view"] });

  /* set header */
  useEffect(() => {
    setHeaderTitle("Payment Methods");
  }, [setHeaderTitle]);

  /* redirect if no permission */
  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  /* guards */
  if (permLoading || !canView) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">
          Payment Methods
        </h1>
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
