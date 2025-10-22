// src/app/(dashboard)/affiliates/logs/client-page.tsx
"use client";

import { Suspense, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogsTable } from "../components/logs-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

export default function ClientAffiliateLogsPage() {
  const router = useRouter();
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  const {
    hasPermission: canViewLogs,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { affiliates: ["logs"] });

  // Redirect away if no "logs" permission
  useEffect(() => {
    if (!permLoading && !canViewLogs) {
      router.replace("/affiliates");
    }
  }, [permLoading, canViewLogs, router]);

  // Guard until permissions resolved
  if (permLoading) return null;
  if (!canViewLogs) return null;

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* heading */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Affiliate Logs</h1>
        <p className="text-muted-foreground">
          All point‐earning and adjustment events for your clients
        </p>
      </div>

      {/* back to dashboard */}
      <div className="text-right">
        <Link href="/affiliates">
          <Button variant="secondary">Back to Affiliates</Button>
        </Link>
      </div>

      {/* logs table */}
      <Suspense fallback={<p className="text-sm">Loading logs…</p>}>
        <LogsTable />
      </Suspense>
    </div>
  );
}
