"use client"

import { useEffect } from "react";
import { SuppliersView } from "./components/suppliers-table";

// Reusable info tooltip + dialog component
import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function Suppliers() {
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Suppliers") // Set the header title for this page
  }, [setHeaderTitle])
  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Suppliers"
              description="Manage your suppliers." />
          </div>
          {/* Use InfoHelpDialog with the new `content` prop */}
          <InfoHelpDialog
            title="About suppliers"
            tooltip="What are suppliers?"
            content={
              <>
                <p>
                  <strong>Suppliers</strong> are the vendors or manufacturers you purchase products or materials from. Managing suppliers helps you maintain a clear record of your sourcing partners and streamline your supply chain.
                </p>
                <p>
                  From this view, you can store key supplier information, track purchase relationships, and reference suppliers when restocking inventory or assigning product origins.
                </p>
                <p>
                  In the table below, you can view, edit, or delete suppliers. Click the <strong>+</strong> button to add a new supplier and keep your purchasing network organized.
                </p>
              </>
            }
          />
        </div>
      </div>
      <SuppliersView />
    </div>
  );
}
