// src/app/(dashboard)/discount-rules/page.tsx
"use client";

import { useEffect } from "react";
import { DiscountRulesTable } from "./components/discount-rules-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";

export default function DiscountRulesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  useEffect(() => {
    setHeaderTitle("Tier pricing");
  }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Tier pricing</h1>
        <p className="text-muted-foreground">Manage your tiers pricing.</p>
      </div>
      <Suspense fallback={<div>Loading tiers pricingn</div>}>
        <DiscountRulesTable />
      </Suspense>
    </div>
  );
}
