// src/app/(dashboard)/products/categories/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { CategoryTable } from "./components/category-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

/* -------------------------------------------------------------------------- */

export default function CategoriesPage() {
  const router = useRouter();
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Product categories") // Set the header title for this page
  }, [setHeaderTitle])

  /* ── active organisation id ─────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── permission check: productCategories:view ───────────────────── */
  const {
    hasPermission: canViewCategories,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { productCategories: ["view"] });

  /* ── set page title ─────────────────────────────────────────────── */
  useEffect(() => { setHeaderTitle("Product categories"); }, [setHeaderTitle]);

  /* ── redirect if no access ──────────────────────────────────────── */
  useEffect(() => {
    if (!permLoading && !canViewCategories) {
      router.replace("/dashboard");
    }
  }, [permLoading, canViewCategories, router]);

  /* ── guards during loading / redirect ───────────────────────────── */
  if (permLoading || !canViewCategories) return null;

  /* ── render ─────────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Categories"
              description="Manage your product categories and their organization." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About product categories"
            tooltip="What are product categories?"
            content={
              <>
                <p>
                  <strong>Product categories</strong> help you organize and group your products, making it easier to manage your catalog and improve the shopping experience.
                </p>
                <p>
                  Categories allow you to segment products by type, brand, collection, or any structure that fits your business. Assigning products to categories helps keep your store organized and searchable.
                </p>
                <p>
                  In the table below, you can create, edit, or delete categories. Click the <strong>+</strong> button to add a new category, then assign products to it from the product settings page.
                </p>
              </>
            }
          />
        </div>
      </div>
      <Suspense fallback={<div>Loading categories table...</div>}>
        <CategoryTable />
      </Suspense>
    </div>
  );
}
