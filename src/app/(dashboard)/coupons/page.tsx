// src/app/(dashboard)/coupons/page.tsx         ← adjust path if different
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Suspense } from "react";

import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";

import { CouponsTable } from "./components/coupons-table";

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
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Coupons</h1>
        <p className="text-muted-foreground">Manage your coupons.</p>
      </div>

      <Suspense fallback={<div>Loading coupons table…</div>}>
        <CouponsTable />
      </Suspense>
    </div>
  );
}
