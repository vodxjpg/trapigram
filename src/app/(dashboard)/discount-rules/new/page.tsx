// src/app/(dashboard)/discount-rules/new/page.tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { DiscountRuleForm } from "../components/discount-rules-form";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

export default function NewDiscountRulePage() {
  const router = useRouter();

  // ── active organization ───────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // ── permission to create tier pricing ─────────────────────────────────
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { tierPricing: ["create"] });

  // redirect if no create permission
  useEffect(() => {
    if (!permLoading && !canCreate) {
      router.replace("/discount-rules");
    }
  }, [permLoading, canCreate, router]);

  if (permLoading || !canCreate) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/discount-rules">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">New Tier Price</h1>
          <p className="text-muted-foreground">Create a discount rule.</p>
        </div>
      </div>
      <DiscountRuleForm />
    </div>
  );
}
