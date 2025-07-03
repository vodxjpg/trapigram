// src/app/(dashboard)/affiliates/levels/new/page.client.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LevelForm } from "../level-form";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export function ClientNewLevelPage() {
  const router = useRouter();

  // get current organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check "settings" permission for affiliates
  const {
    hasPermission: canCreateLevel,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { affiliates: ["settings"] });

  // redirect if no permission
  useEffect(() => {
    if (!permLoading && !canCreateLevel) {
      router.replace("/affiliates");
    }
  }, [permLoading, canCreateLevel, router]);

  // guard until permission resolved
  if (permLoading) return null;
  if (!canCreateLevel) return null;

  return (
    <div className="container mx-auto py-6">
      <LevelForm />
    </div>
  );
}
