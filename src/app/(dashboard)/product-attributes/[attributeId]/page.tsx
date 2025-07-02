// src/app/(dashboard)/product-attributes/[attributeId]/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { usePermission } from "@/hooks/use-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";
import { TermTable } from "./terms/term-table";

export default function AttributeTermsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const can = usePermission(organizationId);;
  const { attributeId } = useParams() as { attributeId: string };

  // Set page title
  useEffect(() => {
    setHeaderTitle("Attribute Terms");
  }, [setHeaderTitle]);

  // Redirect if no update permission
  useEffect(() => {
    if (!can.loading && !can({ productAttributes: ["update"] })) {
      router.replace("/product-attributes");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ productAttributes: ["update"] })) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Terms</h1>
        <p className="text-muted-foreground">
          Manage terms for this attribute (e.g., Nike, Puma for Brand).
        </p>
      </div>
      <Suspense fallback={<div>Loading terms table...</div>}>
        <TermTable attributeId={attributeId} />
      </Suspense>
    </div>
  );
}
