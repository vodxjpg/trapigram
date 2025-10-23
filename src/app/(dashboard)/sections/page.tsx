// src/app/(dashboard)/sections/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SectionsTable } from "./components/sections-table";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

export default function SectionsPage() {
  const router = useRouter();

  // 1) Read active org FIRST and gate on it
  const { data: activeOrg } = authClient.useActiveOrganization();

  // While the active org is not resolved yet, render nothing.
  // (Prevents downstream hooks from being called with changing assumptions)
  if (activeOrg === undefined) return null;

  const organizationId = activeOrg?.id ?? null;

  // 2) Now it’s safe to call permission hooks (order won’t change between renders)
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { sections: ["view"] });

  const { hasPermission: canCreate } = useHasPermission(organizationId, {
    sections: ["create"],
  });

  // redirect if not allowed to view
  useEffect(() => {
    if (!permLoading && !canView) {
      router.replace("/dashboard");
    }
  }, [permLoading, canView, router]);

  if (permLoading || !canView) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex justify-end mb-4">
        {canCreate && (
          <Button className="hidden" onClick={() => router.push("/sections/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Section
          </Button>
        )}
      </div>
      <SectionsTable />
    </div>
  );
}
