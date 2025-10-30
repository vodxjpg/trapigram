// src/app/(dashboard)/warehouses/page.tsx
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { WarehouseTable } from "./components/warehouse-table";
import { useHasPermission } from "@/hooks/use-has-permission";
import { authClient } from "@/lib/auth-client";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function WarehousesPage() {
  const { setHeaderTitle } = useHeaderTitle();
  const router = useRouter();

  // get active organization
  const { data: activeOrg } = authClient.useActiveOrganization();
  const organizationId = activeOrg?.id ?? null;

  // check view permission on warehouses
  const {
    hasPermission: canView,
    isLoading: permLoading,
  } = useHasPermission(organizationId, { warehouses: ["view"] });

  useEffect(() => {
    setHeaderTitle("Warehouses");
  }, [setHeaderTitle]);

  // wait for permission resolution
  if (permLoading) return null;

  // show error if not allowed
  if (!canView) {
    return (
      <div className="container mx-auto py-6 px-6 text-center text-red-600">
        You don’t have permission to view warehouses.
      </div>
    );
  }

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Warehouses"
              description=" Manage your warehouses and their associated organizations and countries." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About warehouses"
            tooltip="What are warehouses?"
            content={
              <>
                <p>
                  <strong>Warehouses</strong> are the locations where you store your products before they are sold or distributed. Each warehouse can hold different quantities of stock and serve different regions or sales channels.
                </p>
                <p>
                  Managing warehouses allows you to organize inventory by location, track availability, and optimize fulfillment. This is especially helpful if you operate multiple storage sites or ship products to different countries.
                </p>
                <p>
                  In the table below, you can view, edit, or delete warehouses. Click the <strong>+</strong> button to add a new warehouse and start assigning stock to it from your product or inventory views.
                </p>
              </>
            }
          />
        </div>
      </div>
      <WarehouseTable />
    </div>
  );
}
