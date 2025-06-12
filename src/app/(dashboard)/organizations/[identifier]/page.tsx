// src/app/(dashboard)/organizations/[slug]/page.tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useHeaderTitle } from "@/context/HeaderTitleContext";
import { MembersTable } from "./members-table";
import { InvitationsTable } from "./invitations-table";
import { InviteMemberForm } from "./invite-member-form";
import { toast } from "sonner";

type Organization = {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  countries?: string[] | null;
  metadata?: Record<string, any> | null;
  encryptedSecret?: string | null;
  memberCount: number;
  userRole: string;
};

export default function OrganizationDetailsPage() {
  const params = useParams();
  const { setHeaderTitle } = useHeaderTitle();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const response = await fetch(
            `/api/organizations/${params.identifier}`,
            { credentials: "include" }
          );
        if (!response.ok) {
          throw new Error(`Failed to fetch organization: ${response.statusText}`);
        }
        const { organization: orgData } = await response.json();
        console.log("Fetched organization data:", orgData);
        setOrganization(orgData);
        setHeaderTitle(orgData.name);
      } catch (error) {
        console.error("Error fetching organization:", error);
        toast.error("Failed to load organization details.");
      } finally {
        setLoading(false);
      }
    };

    if (params.identifier) fetchData();
  }, [params.slug, setHeaderTitle]);

  if (loading) {
    return <div className="flex items-center justify-center h-full">Loading...</div>;
  }

  if (!organization) {
    return <div className="flex items-center justify-center h-full">Organization not found</div>;
  }

  console.log("Rendering with organization:", organization);

  return (
    <div className="flex flex-col gap-6 p-6">
      <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
      <p className="text-muted-foreground">Manage organization members and invitations.</p>

      {["owner", "manager"].includes(organization.userRole) && (
        <InviteMemberForm organizationId={organization.id} currentUserRole={organization.userRole} />
      )}

      <Tabs defaultValue="members" className="w-full">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Pending Invitations</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <MembersTable
            organizationId={organization.id}
            organizationSlug={organization.slug}
            currentUserRole={organization.userRole}
          />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable
            organizationId={organization.id}
            organizationSlug={organization.slug}
            currentUserRole={organization.userRole}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}