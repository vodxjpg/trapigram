// src/app/(dashboard)/products/categories/page.tsx
"use client";

import { useEffect }          from "react";
import { useRouter }         from "next/navigation";
import { Suspense }          from "react";

import { authClient }        from "@/lib/auth-client";
import { useHasPermission }  from "@/hooks/use-has-permission";
import { useHeaderTitle }    from "@/context/HeaderTitleContext";

import { CategoryTable }     from "./category-table";

/* -------------------------------------------------------------------------- */

export default function CategoriesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router             = useRouter();

  /* ── active organisation id ─────────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── permission check: productCategories:view ───────────────────── */
  const {
    hasPermission: canViewCategories,
    isLoading:     permLoading,
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
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Categories</h1>
        <p className="text-muted-foreground">
          Manage your product categories and their organization.
        </p>
      </div>

      <Suspense fallback={<div>Loading categories table...</div>}>
        <CategoryTable />
      </Suspense>
    </div>
  );
}
