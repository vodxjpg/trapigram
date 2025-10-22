// src/app/(dashboard)/affiliates/levels/client-page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LevelsTable } from "./levels-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function ClientAffiliateLevelsPage() {
  const router = useRouter();

  // get current organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check "settings" permission for affiliates
  const {
    hasPermission: canViewLevels,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { affiliates: ["settings"] });

  // Redirect away if no settings permission
  useEffect(() => {
    if (!permLoading && !canViewLevels) {
      router.replace("/affiliates");
    }
  }, [permLoading, canViewLevels, router]);

  // guard until permission resolved
  if (permLoading) return null;
  if (!canViewLevels) return null;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/affiliates">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Affiliate Levels</h1>
          <p className="text-muted-foreground">
            Manage ranks and required points for your affiliates
          </p>
        </div>
        <div className="ml-auto">
          <Link href="/affiliates/levels/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add Level
            </Button>
          </Link>
        </div>
      </div>

      <LevelsTable />
    </div>
  );
}
