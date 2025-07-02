// src/app/(dashboard)/affiliates/client-dashboard.tsx  (CLIENT component)
"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ClientsTable } from "../clients/clients-table";
import { usePermission } from "@/hooks/use-permission";

export default function ClientDashboard() {
  const router = useRouter();
  const can = usePermission(organizationId);;

  if (can.loading) return null;
  if (!can({ affiliates: ["view"] })) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to access the Affiliates dashboard.
      </div>
    );
  }

  const canPoints   = can({ affiliates: ["points"] });
  const canLevels   = can({ affiliates: ["settings"] });
  const canLogs     = can({ affiliates: ["logs"] });
  const canProducts = can({ affiliates: ["products"] });

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Affiliates</h1>
        <p className="text-muted-foreground">
          Manage client balances, levels and programme settings
        </p>
      </div>

      <div className="flex flex-wrap gap-2 justify-end">
        {canLevels && (
          <Link href="/affiliates/levels">
            <Button variant="secondary">Affiliate Levels</Button>
          </Link>
        )}
        {canLogs && (
          <Link href="/affiliates/logs">
            <Button variant="secondary">Affiliate Logs</Button>
          </Link>
        )}
        {canProducts && (
          <Link href="/affiliates/products">
            <Button variant="secondary">Affiliate Products</Button>
          </Link>
        )}
        {canLevels && (
          <Link href="/affiliates/settings">
            <Button variant="secondary">Affiliate Settings</Button>
          </Link>
        )}
      </div>

      {canPoints ? (
        <Suspense fallback={<p className="text-sm">Loading clients…</p>}>
          <ClientsTable />
        </Suspense>
      ) : (
        <div className="py-6 text-center text-red-600">
          You don’t have permission to view affiliate points.
        </div>
      )}
    </div>
  );
}
