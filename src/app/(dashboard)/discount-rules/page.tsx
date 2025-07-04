// src/app/(dashboard)/discount-rules/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DiscountRulesTable } from "./components/discount-rules-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";

export default function DiscountRulesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // ── active organization ───────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // ── permissions ────────────────────────────────────────────────────────
  const {
    hasPermission: canView,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { tierPricing: ["view"] });
  const { hasPermission: canCreate } = useHasPermission(
    organizationId,
    { tierPricing: ["create"] },
  );

  useEffect(() => {
    setHeaderTitle("Tier pricing");
  }, [setHeaderTitle]);

  if (permLoading) return null;

  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view tier pricing.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tier pricing</h1>
          <p className="text-muted-foreground">Manage your tier pricing rules.</p>
        </div>
        {canCreate && (
          <Button onClick={() => router.push("/discount-rules/new")}>
            Add Rule
          </Button>
        )}
      </div>
      <Suspense fallback={<div>Loading tier pricing table…</div>}>
        <DiscountRulesTable />
      </Suspense>
    </div>
  );
}
