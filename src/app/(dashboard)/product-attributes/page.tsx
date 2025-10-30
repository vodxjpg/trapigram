// src/app/(dashboard)/product-attributes/page.tsx
"use client";

import { useEffect } from "react";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { AttributeTable } from "./components/attribute-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export default function ProductAttributesPage() {
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Product attributes") // Set the header title for this page
  }, [setHeaderTitle])

  /* ── active organisation → permission hook ─────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canView,       // true | false
    isLoading: permLoading,   // while resolving
  } = useHasPermission(organizationId, { productAttributes: ["view"] });


  /* ── guards ─────────────────────────────────────────────────────── */
  if (permLoading) return null;

  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view product attributes.
      </div>
    );
  }

  /* ── page UI ────────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Attributes"
              description="Manage your product attributes (e.g., Brand, Color) and their terms." />
          </div>


          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About product attributes"
            tooltip="What are product attributes?"
            content={
              <>
                <p>
                  <strong>Product attributes</strong> are characteristics that define and describe your products, such as brand, color, size, material, or any other specification.
                </p>
                <p>
                  Attributes help organize products more clearly and allow customers or systems to filter, search, and differentiate items within your catalog. They also play an essential role when creating product variations.
                </p>
                <p>
                  In the table below, you can create, edit, or delete attributes. Click the <strong>+</strong> button to add a new attribute, then assign it to products or use it when creating variations.
                </p>
              </>
            }

          />
        </div>
      </div>
      <Suspense fallback={<div>Loading categories table...</div>}>
        <AttributeTable />
      </Suspense>

    </div>
  );
}
