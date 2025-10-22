// src/app/(dashboard)/product-attributes/page.tsx
"use client";

import { useEffect } from "react";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

import { AttributeTable } from "./components/attribute-table";

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
export default function ProductAttributesPage() {
  const { setHeaderTitle } = useHeaderTitle();

  /* ── active organisation → permission hook ─────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canView,       // true | false
    isLoading: permLoading,   // while resolving
  } = useHasPermission(organizationId, { productAttributes: ["view"] });

  /* set page title in global header */
  useEffect(() => { setHeaderTitle("Product Attributes"); }, [setHeaderTitle]);

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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Attributes</h1>
        <p className="text-muted-foreground">
          Manage your product attributes (e.g., Brand, Color) and their terms.
        </p>
      </div>

      <Suspense fallback={<div>Loading attributes table…</div>}>
        <AttributeTable />
      </Suspense>
    </div>
  );
}
