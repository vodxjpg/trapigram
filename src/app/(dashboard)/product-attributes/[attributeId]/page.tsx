"use client";

import { useEffect } from "react";
import { TermTable } from "./term-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

export default function AttributeTermsPage({ params }: { params: { attributeId: string } }) {
  const { setHeaderTitle } = useHeaderTitle();

  useEffect(() => {
    setHeaderTitle("Attribute Terms");
  }, [setHeaderTitle]);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Terms</h1>
        <p className="text-muted-foreground">
          Manage terms for this attribute (e.g., Nike, Puma for Brand).
        </p>
      </div>
      <TermTable attributeId={params.attributeId} />
    </div>
  );
}