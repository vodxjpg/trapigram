// /home/zodx/Desktop/trapigram/src/app/(dashboard)/organizations/[slug]/page.tsx
"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHeaderTitle } from "@/context/HeaderTitleContext"
import { MembersTable } from "./members-table"
import { InvitationsTable } from "./invitations-table"
import { InviteMemberForm } from "./invite-member-form"
import { toast } from "sonner"
import { authClient } from "@/lib/auth-client"

type Organization = {
  id: string
  name: string
  slug: string
  logo?: string | null
}

export default function OrganizationDetailsPage() {
  const params = useParams();
  const { setHeaderTitle } = useHeaderTitle();
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOrganization = async () => {
      setLoading(true);
      try {
        const { data, error } = await authClient.organization.getFullOrganization({
          organizationSlug: params.slug as string,
        });
        if (error) throw new Error(error.message);
        setOrganization(data);
        setHeaderTitle(data.name);
      } catch (error) {
        console.error("Error fetching organization:", error);
        toast.error("Failed to load organization details");
      } finally {
        setLoading(false);
      }
    };
    if (params.slug) fetchOrganization();
  }, [params.slug, setHeaderTitle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Loading organization details...</p>
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="flex items-center justify-center h-full">
        <p>Organization not found</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{organization.name}</h1>
        <p className="text-muted-foreground">Manage organization members and invitations.</p>
      </div>
      <InviteMemberForm organizationId={organization.id} />
      <Tabs defaultValue="members" className="w-full">
        <TabsList>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="invitations">Pending Invitations</TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-4">
          <MembersTable organizationId={organization.id} />
        </TabsContent>
        <TabsContent value="invitations" className="mt-4">
          <InvitationsTable organizationId={organization.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}