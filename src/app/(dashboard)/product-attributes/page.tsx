// src/app/(dashboard)/product-attributes/page.tsx
"use client";

import { useEffect } from "react";
import { Suspense } from "react";
import { usePermission } from "@/hooks/use-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { AttributeTable } from "./attribute-table";

export default function ProductAttributesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const can = usePermission(organizationId);;

  useEffect(() => {
    setHeaderTitle("Product Attributes");
  }, [setHeaderTitle]);

  if (can.loading) return null;

  if (!can({ productAttributes: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view product attributes.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Attributes</h1>
        <p className="text-muted-foreground">
          Manage your product attributes (e.g., Brand, Color) and their terms.
        </p>
      </div>
      <Suspense fallback={<div>Loading attributes table...</div>}>
        <AttributeTable />
      </Suspense>
    </div>
  );
}
