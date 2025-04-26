"use client";

import { useEffect } from "react";
import { AttributeTable } from "./attribute-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from 'react'; // Added Suspense import

export default function ProductAttributesPage() {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => {
    setHeaderTitle("Product Attributes");
  }, [setHeaderTitle]);

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