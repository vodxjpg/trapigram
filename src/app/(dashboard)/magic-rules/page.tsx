"use client";
import { useEffect, Suspense } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { useHasPermission } from "@/hooks/use-has-permission";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { MagicRulesTable } from "./components/rules-table";

export default function MagicRulesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;
  const { hasPermission, isLoading } = useHasPermission(organizationId, { rule: ["view"] });

  useEffect(() => setHeaderTitle("Magic Rules"), [setHeaderTitle]);
  useEffect(() => { if (!isLoading && !hasPermission) router.replace("/dashboard"); }, [isLoading, hasPermission, router]);
  if (isLoading || !hasPermission) return null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Magic Rules</h1>
        <p className="text-muted-foreground">Automations that react to order events.</p>
      </div>
      <Suspense fallback={<div>Loading rules…</div>}>
        <MagicRulesTable />
      </Suspense>
    </div>
  );
}
