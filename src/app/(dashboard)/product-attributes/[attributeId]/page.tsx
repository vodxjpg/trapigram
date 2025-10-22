// src/app/(dashboard)/product-attributes/[attributeId]/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { Suspense } from "react";
import { TermTable } from "./terms/components/term-table";

export default function AttributeTermsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const { attributeId } = useParams() as { attributeId: string };

  // Set page title
  useEffect(() => {
    setHeaderTitle("Attribute Terms");
  }, [setHeaderTitle]);

  // Get active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  // Check update permission on productAttributes
  const {
    hasPermission: canUpdate,
    isLoading: updateLoading,
  } = useHasPermission(orgId, { productAttributes: ["update"] });

  // Redirect if no update permission
  useEffect(() => {
    if (!updateLoading && !canUpdate) {
      router.replace("/product-attributes");
    }
  }, [updateLoading, canUpdate, router]);

  if (updateLoading) return null;
  if (!canUpdate) return null;

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
