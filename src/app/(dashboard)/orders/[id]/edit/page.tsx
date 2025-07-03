// src/app/orders/[id]/page.tsx  (full, runnable file)
"use client";

import { useEffect }             from "react";
import { useParams, useRouter }  from "next/navigation";
import OrderFormVisual           from "./orderForm";
import { useHasPermission }      from "@/hooks/use-has-permission";
import { authClient }            from "@/lib/auth-client";

export default function OrderPage() {
  const { id } = useParams<{ id: string }>();  // URL param /orders/[id]
  const router  = useRouter();

  /* ── resolve active organisation ─────────────────────────────── */
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId      = activeOrg?.id ?? null;

  /* ── secured permission check ────────────────────────────────── */
  const {
    hasPermission: canViewOrder,
    isLoading:     permLoading,
  } = useHasPermission(organizationId, { order: ["view"] });

  /* ── redirect on denial (runs once permissions are known) ────── */
  useEffect(() => {
    if (!permLoading && !canViewOrder) {
      router.replace("/orders");
    }
  }, [permLoading, canViewOrder, router]);

  if (permLoading || !canViewOrder) return null; // waiting / redirecting
  return <OrderFormVisual orderId={id} />;
}
