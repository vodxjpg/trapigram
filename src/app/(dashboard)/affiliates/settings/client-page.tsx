// src/app/(dashboard)/affiliates/settings/client-page.tsx
"use client";

import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsForm } from "./components/settings-form";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function ClientAffiliateSettingsPage() {
  const router = useRouter();

  // get current organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check "settings" permission
  const {
    hasPermission: canSettings,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { affiliates: ["settings"] });

  // redirect away if not allowed
  useEffect(() => {
    if (!permLoading && !canSettings) {
      router.replace("/affiliates");
    }
  }, [permLoading, canSettings, router]);

  if (permLoading) return null;
  if (!canSettings) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6 px-3">
      <div className="flex items-center gap-2">
        <Link href="/affiliates">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Affiliate Settings
          </h1>
          <p className="text-muted-foreground">
            Configure how clients earn points automatically
          </p>
        </div>
      </div>

      <Suspense
        fallback={
          <p className="text-sm flex flex-col justify-center">
            Loading settings…
          </p>
        }
      >
        <SettingsForm />
      </Suspense>
    </div>
  );
}
