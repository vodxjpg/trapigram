// src/app/(dashboard)/affiliates/settings/client-page.tsx
"use client";

import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingsForm } from "./components/settings-form";
import { usePermission } from "@/hooks/use-permission";

export default function ClientAffiliateSettingsPage() {
  const router = useRouter();
  const can = usePermission(organizationId);;

  // Redirect away if they lack the "settings" permission
  useEffect(() => {
    if (!can.loading && !can({ affiliates: ["settings"] })) {
      router.replace("/affiliates");
    }
  }, [can, router]);

  if (can.loading) return null;
  if (!can({ affiliates: ["settings"] })) return null;

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
