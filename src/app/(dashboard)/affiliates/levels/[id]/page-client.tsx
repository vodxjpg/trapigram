// src/app/(dashboard)/affiliates/levels/[id]/page.client.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LevelForm } from "../level-form";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

interface Props { id: string }

export function ClientEditLevelPage({ id }: Props) {
  const router = useRouter();

  // get active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check “settings” permission for affiliates
  const {
    hasPermission: canEditLevel,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { affiliates: ["settings"] });

  // redirect away if no permission
  useEffect(() => {
    if (!permLoading && !canEditLevel) {
      router.replace("/affiliates");
    }
  }, [permLoading, canEditLevel, router]);

  // guard until permissions resolved
  if (permLoading) return null;
  if (!canEditLevel) return null;

  return (
    <div className="container mx-auto py-6">
      <LevelForm id={id} />
    </div>
  );
}
