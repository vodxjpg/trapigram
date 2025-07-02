"use client";

import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClientsTable } from "./clients-table";
import { usePermission } from "@/hooks/use-permission";
import { useRouter } from "next/navigation";

export default function ClientsPage() {
  const can = usePermission(organizationId);;
  const router = useRouter();

  // 1) Wait for permissions
  if (can.loading) return null;

  // 2) Redirect if no view
  if (!can({ customer: ["view"] })) {
    router.replace("/");
    return null;
  }

  const canCreate = can({ customer: ["create"] });

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Clients</h1>
          <p className="text-muted-foreground">Manage your client database</p>
        </div>
        {canCreate && (
          <Link href="/clients/new">
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Add New Client
            </Button>
          </Link>
        )}
      </div>
      <ClientsTable />
    </div>
  );
}
