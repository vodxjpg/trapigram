// src/app/(dashboard)/shipping-companies/new/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { Button } from "@/components/ui/button";
import { ShippingMethodForm } from "../components/shipping-companies-form";

export default function NewShippingMethodPage() {
  const router = useRouter();

  // ── active organization → id for permission hook ─────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const orgId = activeOrg?.id ?? null;

  // ── secure permission check for creating shippingMethods ─────────────────
  const {
    hasPermission: canCreate,
    isLoading: createLoading,
  } = useHasPermission(orgId, { shippingMethods: ["create"] });

  // ── redirect if no create permission ─────────────────────────────────────
  useEffect(() => {
    if (!createLoading && !canCreate) {
      router.replace("/shipping-companies");
    }
  }, [createLoading, canCreate, router]);

  // ── guard while loading or lacking permission ────────────────────────────
  if (createLoading || !canCreate) {
    return null;
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/shipping-companies">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Shipping Company</h1>
          <p className="text-muted-foreground">
            Create a new shipping company.
          </p>
        </div>
      </div>
      <ShippingMethodForm />
    </div>
  );
}
