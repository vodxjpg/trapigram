"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import OrderForm from "./order-form";

export default function CreateOrderPage() {
  const router = useRouter();

  // resolve active org → permission scope
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // creating/modifying orders maps to "order:update" in our ACL
  const {
    hasPermission: canEditOrders,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { order: ["update"] });

  // redirect away if not allowed (after permission resolved)
  useEffect(() => {
    if (!permLoading && !canEditOrders) {
      router.replace("/orders");
    }
  }, [permLoading, canEditOrders, router]);

  if (permLoading || !canEditOrders) return null; // wait / redirecting
  return <OrderForm />;
}