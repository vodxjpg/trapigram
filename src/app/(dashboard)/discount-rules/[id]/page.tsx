// /home/zodx/Desktop/trapigram/src/app/(dashboard)/discount-rules/[id]/page.tsx
// src/app/(dashboard)/discount-rules/[id]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { DiscountRuleForm } from "../components/discount-rules-form";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

const LOG = "[TierPricing/Edit]";

export default function EditDiscountRulePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  // ── active organization ───────────────────────────────────────────────
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // ── permission to update tier pricing ─────────────────────────────────
  const {
    hasPermission: canUpdate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { tierPricing: ["update"] });

  const [rule,   setRule  ] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // redirect if no update permission
  useEffect(() => {
    if (!permLoading && !canUpdate) {
      // eslint-disable-next-line no-console
      console.debug(`${LOG} no permission; redirecting`, { canUpdate })
      router.replace("/discount-rules");
    }
  }, [permLoading, canUpdate, router]);

  // fetch rule once we know we can update
  useEffect(() => {
    if (permLoading || !canUpdate) return;
    setLoading(true);
    // eslint-disable-next-line no-console
    console.debug(`${LOG} fetching rule`, { id });
    fetch(`/api/tier-pricing/${id}`)
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Failed to fetch (${res.status}) ${text}`);
        }
        return res.json();
      })
      .then((data) => {
        setRule(data);
        // eslint-disable-next-line no-console
        console.debug(`${LOG} rule loaded`, { steps: data?.steps?.length, products: data?.products?.length });
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`${LOG} fetch error`, e);
        toast.error((e as Error).message);
        router.replace("/discount-rules");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [permLoading, canUpdate, id, router]);

  if (permLoading) return null;
  if (!canUpdate) return null;

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/discount-rules">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold">Edit Tier Pricing</h1>
          <p className="text-muted-foreground">Update your rule.</p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <DiscountRuleForm discountRuleData={rule} isEditing />
      )}
    </div>
  );
}
