"use client";
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ClientsTable } from "./clients-table";
import { usePermission } from "@/hooks/use-permission";
import { useRouter } from "next/navigation";

export default function ClientsPage() {
   const can = usePermission(); ;
  const router = useRouter();

  
  /* ---------- permission resolved here ---------- */
  const [mayView, setMayView] = useState<boolean | null>(null);

  useEffect(() => {
    if (!can.loading) {
      setMayView(can({ customer: ["view"] }));
    }
  }, [can]);

  // still figuring it out → nothing yet
  if (mayView === null) return null;

  // didn’t pass → redirect once, then bail out
  if (!mayView) {
    router.replace("/dashboard");
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
