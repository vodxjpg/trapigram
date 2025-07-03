"use client";

import Link                  from "next/link";
import { useRouter }         from "next/navigation";
import { ArrowLeft }         from "lucide-react";

import { authClient }        from "@/lib/auth-client";
import { useHasPermission }  from "@/hooks/use-has-permission";

import { CouponForm }        from "../coupons-form";
import { Button }            from "@/components/ui/button";

/* -------------------------------------------------------------------------- */

export default function NewCouponPage() {
  const router = useRouter();

  /* ── active organisation id ───────────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── permission (new hook) ───────────────────────────────────── */
  const {
    hasPermission: canCreate,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { coupon: ["create"] });

  /* ── guards ──────────────────────────────────────────────────── */
  if (permLoading) return null;
  if (!canCreate) {
    router.replace("/coupons");
    return null;
  }

  /* ── page ────────────────────────────────────────────────────── */
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center gap-2">
        <Link href="/coupons">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Add New Coupon</h1>
          <p className="text-muted-foreground">
            Create a new coupon in your database
          </p>
        </div>
      </div>

      <CouponForm />
    </div>
  );
}
