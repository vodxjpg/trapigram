// src/app/orders/[id]/page.tsx  (full, runnable file)
"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import OrderFormVisual from "./order-form";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();  // URL param /orders/[id]
  const router = useRouter();

  /* ── resolve active organisation ─────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  /* ── secured permission check ────────────────────────────────── */
  const {
    hasPermission: canEditOrder,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { order: ["update"] });

  /* ── redirect on denial (runs once permissions are known) ────── */
  useEffect(() => {
    if (!permLoading && !canEditOrder) {
      router.replace("/orders");
    }
  }, [permLoading, canEditOrder, router]);

  if (permLoading || !canEditOrder) return null; // waiting / redirecting
  return <OrderFormVisual orderId={id} />;
}
