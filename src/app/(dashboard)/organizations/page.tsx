"use client"

import { useEffect } from "react"
import { OrganizationTable } from "./components/organization-table"

import InfoHelpDialog from "@/components/dashboard/info-help-dialog";
import { PageHeader } from "@/components/page-header";
import { useHeaderTitle } from "@/context/HeaderTitleContext"

export default function OrganizationsPage() {
  const { setHeaderTitle } = useHeaderTitle()

  useEffect(() => {
    setHeaderTitle("Organizations") // Set the header title for this page
  }, [setHeaderTitle])

  return (
    <div className="container mx-auto py-6 px-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <PageHeader
              title="Organizations"
              description="Manage your organizations and their members." />
          </div>
          <InfoHelpDialog
            title="About organizations"
            tooltip="What are organizations?"
            content={
              <>
                <p>
                  <strong>Organizations</strong> represent your main business entities — they work like stores where you manage your products, users, and settings.
                </p>
                <p>
                  Each organization can contain multiple members with different roles and permissions. This allows teams to collaborate and manage their operations efficiently.
                </p>
                <p>
                  In the table below, you can view all your organizations, edit their details, or invite new members to join. If you don’t have one yet, click the <strong>+</strong> button to create your first organization.
                </p>
              </>
            }
          />
        </div>
      </div>
      <OrganizationTable />
    </div>
  )
}

