// src/app/(dashboard)/coupons/page.tsx         ← adjust path if different
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";

import { CouponsTable } from "./components/coupons-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

/* ------------------------------------------------------------------ */

export default function CouponsPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  /* ── active-organisation → permission hook ─────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canViewCoupons,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { coupon: ["view"] });

  /* ── set header title once ─────────────────────────────────────── */
  useEffect(() => {
    setHeaderTitle("Coupons");
  }, [setHeaderTitle]);

  /* ── redirect if not allowed (after resolve) ───────────────────── */
  useEffect(() => {
    if (!permLoading && !canViewCoupons) {
      router.replace("/dashboard");
    }
  }, [permLoading, canViewCoupons, router]);

  /* ── guards ────────────────────────────────────────────────────── */
  if (permLoading || !canViewCoupons) return null;

  /* ---------------------------------------------------------------- */
  /*  JSX                                                             */
  /* ---------------------------------------------------------------- */
  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Coupons"
              description="Manage your coupons." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About coupons"
            tooltip="What are coupons?"
            content={
              <>
                <p>
                  <strong>Coupons</strong> allow you to offer discounts or special promotions to your customers, helping increase sales, reward loyalty, or boost marketing campaigns.
                </p>
                <p>
                  You can create coupons with different rules, such as percentage or fixed amount discounts, usage limits, expiration dates, or conditions like minimum order value.
                </p>
                <p>
                  In the table below, you can view, edit, or delete coupons. Click the <strong>+</strong> button to create a new coupon and customize your promotion settings.
                </p>
              </>
            }
          />
        </div>
      </div>
      <Suspense fallback={<div>Loading coupons table…</div>}>
        <CouponsTable />
      </Suspense>
    </div>
  );
}
