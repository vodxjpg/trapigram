"use client";

import { useEffect } from "react";
import { TermTable } from "./terms/term-table";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

// Define the props interface to match Next.js dynamic route expectations
interface AttributeTermsPageProps {
  params: Promise<{ attributeId: string }>; // Use Promise for dynamic params
}

// Use async to handle the Promise in params
export default async function AttributeTermsPage({ params }: AttributeTermsPageProps) {
  const { setHeaderTitle } = useHeaderTitle();
  // Resolve the params Promise
  const { attributeId } = await params;

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
      <TermTable attributeId={attributeId} />
    </div>
  );
}