// src/app/(dashboard)/sections/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { SectionsTable } from "./components/sections-table";
import { usePermission } from "@/hooks/use-permission";

export default function SectionsPage() {
  const router = useRouter();
  const can = usePermission(organizationId);;

  const canView   = can({ sections: ["view"] });
  const canCreate = can({ sections: ["create"] });

  // Redirect away if they don't have view permission
  useEffect(() => {
    if (!can.loading && !canView) {
      router.replace("/");
    }
  }, [can.loading, canView, router]);

  if (can.loading || !canView) return null;

  return (
    <div className="container mx-auto py-6">
      <div className="flex justify-end mb-4">
        {canCreate && (
          <Button onClick={() => router.push("/sections/new")}>
            <Plus className="mr-2 h-4 w-4" />
            New Section
          </Button>
        )}
      </div>
      <SectionsTable />
    </div>
  );
}
